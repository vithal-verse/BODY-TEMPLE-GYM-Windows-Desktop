import crypto from "node:crypto";
import { AppError } from "@shared/errors";
import { toPaise } from "@shared/money";
import type { Member, MemberStatus, SheetsConfigInput, SheetsConfigView, SheetsPullResult, SheetsPushResult } from "@shared/types";
import { MEMBER_STATUS_VALUES } from "@shared/types";
import type { DatabaseManager } from "../database/manager";
import type { Logger } from "./logger";
import { MEMBER_COLS, type MemberRow, toMember } from "./mappers";
import type { ExternalPatch, MembersService } from "./members";
import type { Platform } from "./platform";
import type { SettingsService } from "./settings";
import { isDateStr, systemClock, type Clock } from "./util";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://sheets.googleapis.com/v4/spreadsheets";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const TAB = "Members";
const HEADER = ["id", "name", "age", "email", "phone", "plan_name", "start_date", "end_date", "fees_paid", "status", "updated_at"];
const DEBOUNCE_MS = 4000;

type Stored = { spreadsheetId: string; clientEmail: string; autoSync: boolean; lastPushAt: string | null; lastPullAt: string | null; lastError: string | null };
const EMPTY: Stored = { spreadsheetId: "", clientEmail: "", autoSync: false, lastPushAt: null, lastPullAt: null, lastError: null };
type FetchFn = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const str = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());

/** Accepts a bare id or a full https://docs.google.com/spreadsheets/d/<id>/edit URL. */
export function extractSpreadsheetId(input: string): string {
  const m = /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/.exec(input);
  return (m ? m[1] : input).trim();
}

export class SheetsService {
  private token: { value: string; exp: number } | null = null;
  private timer: NodeJS.Timeout | null = null;
  private busy = false;

  constructor(
    private readonly mgr: DatabaseManager,
    private readonly members: MembersService,
    private readonly settings: SettingsService,
    private readonly platform: Platform,
    private readonly log: Logger,
    private readonly clock: Clock = systemClock,
    private readonly fetchFn: FetchFn = ((u, i) => fetch(u, i)) as FetchFn
  ) {}

  private get db() {
    return this.mgr.db;
  }
  private stored(): Stored {
    return { ...EMPTY, ...this.settings.get<Partial<Stored>>("sheets.config", {}) };
  }
  private save(patch: Partial<Stored>) {
    this.settings.set("sheets.config", { ...this.stored(), ...patch });
  }
  private hasKey() {
    return !!this.settings.get<string | null>("sheets.key", null);
  }

  getConfig(): SheetsConfigView {
    const s = this.stored();
    return { ...s, hasPrivateKey: this.hasKey() };
  }

  saveConfig(input: SheetsConfigInput): SheetsConfigView {
    let clientEmail = input.clientEmail.trim();
    let pem = input.privateKey?.trim() ?? "";
    if (pem.startsWith("{")) {
      // The whole downloaded JSON key file was pasted — pull the two fields we need out of it.
      try {
        const j = JSON.parse(pem) as { private_key?: string; client_email?: string };
        pem = j.private_key ?? "";
        clientEmail = clientEmail || j.client_email || "";
      } catch {
        throw new AppError("VALIDATION", "That doesn't look like a valid service-account JSON file.");
      }
    }
    const spreadsheetId = extractSpreadsheetId(input.spreadsheetId);
    if (spreadsheetId && !/^[a-zA-Z0-9_-]{20,}$/.test(spreadsheetId)) throw new AppError("VALIDATION", "That spreadsheet ID doesn't look right. Paste the sheet's URL or its ID.");
    if (clientEmail && !/^[^\s@]+@[^\s@]+$/.test(clientEmail)) throw new AppError("VALIDATION", "Enter the service account's email address.");

    if (pem) {
      const normalised = pem.replace(/\\n/g, "\n");
      try {
        crypto.createPrivateKey(normalised);
      } catch {
        throw new AppError("VALIDATION", "That private key couldn't be read. Paste the full key including the BEGIN/END lines.");
      }
      if (!this.platform.secretsAvailable()) {
        throw new AppError("VALIDATION", "Secure storage isn't available on this PC, so the private key can't be saved safely.");
      }
      this.settings.set("sheets.key", this.platform.encryptSecret(normalised));
      this.token = null;
    }
    this.save({ spreadsheetId, clientEmail, autoSync: input.autoSync });
    return this.getConfig();
  }

  // ---- Google auth + HTTP -------------------------------------------------
  private async accessToken(): Promise<string> {
    const now = this.clock().getTime();
    if (this.token && this.token.exp - 60_000 > now) return this.token.value;
    const cfg = this.stored();
    const cipher = this.settings.get<string | null>("sheets.key", null);
    if (!cfg.clientEmail || !cipher) throw new AppError("VALIDATION", "Add the service account email and private key in Settings first.");
    const iat = Math.floor(now / 1000);
    const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claims = b64url(JSON.stringify({ iss: cfg.clientEmail, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 }));
    let sig: Buffer;
    try {
      sig = crypto.createSign("RSA-SHA256").update(`${head}.${claims}`).sign(this.platform.decryptSecret(cipher));
    } catch {
      throw new AppError("VALIDATION", "The saved private key can't be used. Paste it again in Settings.");
    }
    const res = await this.send(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claims}.${b64url(sig)}` }).toString(),
    });
    if (!res.ok) throw new AppError("NETWORK", "Google rejected the service-account credentials. Check the email and private key.");
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: body.access_token, exp: now + body.expires_in * 1000 };
    return this.token.value;
  }

  private async send(url: string, init: Parameters<FetchFn>[1]) {
    try {
      return await this.fetchFn(url, init);
    } catch {
      throw new AppError("NETWORK", "Couldn't reach Google. Check the internet connection — your gym data on this PC is unaffected.");
    }
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const id = this.stored().spreadsheetId;
    if (!id) throw new AppError("VALIDATION", "Add the spreadsheet ID in Settings first.");
    const token = await this.accessToken();
    const res = await this.send(`${API}/${id}${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      if (res.status === 403) throw new AppError("NETWORK", "Google refused access. Share the spreadsheet with the service account's email as an Editor.");
      if (res.status === 404) throw new AppError("NETWORK", "Spreadsheet not found. Check the spreadsheet ID.");
      throw new AppError("NETWORK", `Google Sheets returned an error (${res.status}).`);
    }
    return (await res.json()) as T;
  }

  private async ensureTab() {
    const meta = await this.call<{ properties?: { title?: string }; sheets?: { properties?: { title?: string } }[] }>("GET", "?fields=properties.title,sheets.properties.title");
    if (!(meta.sheets ?? []).some((s) => s.properties?.title === TAB)) {
      await this.call("POST", ":batchUpdate", { requests: [{ addSheet: { properties: { title: TAB } } }] });
    }
    return meta.properties?.title ?? "Spreadsheet";
  }

  async test(): Promise<{ title: string }> {
    try {
      const title = await this.ensureTab();
      this.save({ lastError: null });
      return { title };
    } catch (e) {
      this.save({ lastError: (e as Error).message });
      throw e;
    }
  }

  // ---- DB -> Sheet ----------------------------------------------------------
  private rowsToPush(): Member[] {
    return (this.db.prepare(`SELECT ${MEMBER_COLS} FROM members ORDER BY created_at ASC, rowid ASC`).all() as MemberRow[]).map(toMember);
  }

  async push(): Promise<SheetsPushResult> {
    try {
      await this.ensureTab();
      const members = this.rowsToPush();
      const values = members.map((m) => [m.id, m.name, m.age ?? "", m.email ?? "", m.phone ?? "", m.plan_name ?? "", m.start_date, m.end_date ?? "", m.fees_paid, m.status, m.updated_at]);
      // RAW: text stays text (a name like "=SUM(1)" can never become a formula) and dates round-trip unchanged.
      await this.call("PUT", `/values/${TAB}!A1:K1?valueInputOption=RAW`, { values: [HEADER] });
      await this.call("POST", `/values/${TAB}!A2:K:clear`, {});
      if (values.length) await this.call("PUT", `/values/${TAB}!A2:K?valueInputOption=RAW`, { values });
      this.save({ lastPushAt: this.clock().toISOString(), lastError: null });
      return { synced: members.length };
    } catch (e) {
      this.save({ lastError: (e as Error).message });
      throw e;
    }
  }

  /** Called after every member change: a debounced background push. Never throws, never blocks the app. */
  notifyChanged(): void {
    const c = this.stored();
    if (!c.autoSync || !c.spreadsheetId || !this.hasKey()) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.busy || !this.mgr.isOpen) return;
      this.busy = true;
      this.push()
        .catch((e) => this.log.warn("Background Google Sheets sync failed", { message: (e as Error).message }))
        .finally(() => (this.busy = false));
    }, DEBOUNCE_MS);
    this.timer.unref?.();
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  // ---- Sheet -> DB ----------------------------------------------------------
  /**
   * Applies edits made in the sheet. A row is only touched if it hasn't changed locally since the
   * last push (its updated_at still matches); otherwise the app wins and the row is counted as a conflict.
   */
  async pull(): Promise<SheetsPullResult> {
    try {
      await this.ensureTab();
      const data = await this.call<{ values?: unknown[][] }>("GET", `/values/${TAB}!A2:K?valueRenderOption=UNFORMATTED_VALUE`);
      const out: SheetsPullResult = { updatedMembers: 0, fieldsChanged: 0, conflictsSkipped: 0, invalidSkipped: 0 };

      for (const row of data.values ?? []) {
        const id = str(row[0]);
        const local = id ? (this.db.prepare(`SELECT ${MEMBER_COLS} FROM members WHERE id = ?`).get(id) as MemberRow | undefined) : undefined;
        if (!local) continue;
        const m = toMember(local);
        if (str(row[10]) !== m.updated_at) {
          out.conflictsSkipped++;
          continue;
        }
        const patch: ExternalPatch = {};
        const bad = () => void out.invalidSkipped++;
        const nameV = str(row[1]);
        if (nameV !== m.name) nameV ? (patch.name = nameV) : bad();
        const ageS = str(row[2]);
        const age = ageS === "" ? null : Number(ageS);
        if (age !== null && !(Number.isInteger(age) && age >= 1 && age <= 120)) bad();
        else if (age !== m.age) patch.age = age;
        for (const [i, key] of [[3, "email"], [4, "phone"], [5, "plan_name"]] as const) {
          const v = str(row[i]) || null;
          if (v !== (m[key] ?? null)) patch[key] = v;
        }
        const startV = str(row[6]);
        if (startV !== m.start_date) isDateStr(startV) ? (patch.start_date = startV) : bad();
        const endV = str(row[7]) || null;
        if (endV !== (m.end_date ?? null)) endV === null || isDateStr(endV) ? (patch.end_date = endV) : bad();
        const paid = Number(str(row[8]) || "0");
        if (!Number.isFinite(paid) || paid < 0) bad();
        else if (toPaise(paid) !== toPaise(m.fees_paid)) patch.fees_paid = paid;
        const status = str(row[9]);
        if (status !== m.status) (MEMBER_STATUS_VALUES as readonly string[]).includes(status) ? (patch.status = status as MemberStatus) : bad();

        const keys = Object.keys(patch);
        if (keys.length) {
          this.members.applyExternalPatch(id, patch);
          out.updatedMembers++;
          out.fieldsChanged += keys.length;
        }
      }
      this.save({ lastPullAt: this.clock().toISOString(), lastError: null });
      // Refresh the sheet so its updated_at column matches the rows we just changed.
      if (out.updatedMembers > 0) await this.push().catch((e) => this.log.warn("Push after pull failed", { message: (e as Error).message }));
      return out;
    } catch (e) {
      this.save({ lastError: (e as Error).message });
      throw e;
    }
  }
}
