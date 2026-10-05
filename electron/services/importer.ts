import fs from "node:fs";
import path from "node:path";
import { AppError } from "@shared/errors";
import { csvToObjects } from "@shared/csv";
import { parseMoneyToPaise } from "@shared/money";
import { computeStatus } from "@shared/status";
import { PAYMENT_METHOD_VALUES, type ImportMode, type ImportSummary, type SupabaseImportInput } from "@shared/types";
import { runInTransaction } from "../database/connection";
import type { DatabaseManager } from "../database/manager";
import type { BackupService } from "./backup";
import type { Logger } from "./logger";
import type { MembersService } from "./members";
import { isDateStr, minutesBetween, systemClock, toLocalDateStr, type Clock } from "./util";

type Row = Record<string, unknown>;
export type RawTables = Partial<Record<(typeof TABLES)[number], Row[]>>;
const TABLES = ["membership_plans", "members", "renewals", "payments", "attendance"] as const;

const blank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");
const text = (v: unknown): string | null => (blank(v) ? null : String(v).trim());
const int = (v: unknown): number | null => (blank(v) || !Number.isFinite(Number(v)) ? null : Math.trunc(Number(v)));
const dateOnly = (v: unknown): string | null => {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(text(v) ?? "");
  return m && isDateStr(m[1]) ? m[1] : null;
};

/** Accepts Postgres/PostgREST timestamp shapes ("2026-09-17 07:17:10.530904+00", "…T…Z", date-only) → canonical ISO. */
export function normalizeTimestamp(v: unknown): string | null {
  const s = text(v);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T00:00:00.000Z`;
  let t = s.replace(" ", "T").replace(/(\.\d{3})\d+/, "$1");
  t = t.replace(/([+-]\d{2})$/, "$1:00").replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  if (!/(Z|[+-]\d{2}:\d{2})$/i.test(t)) t += "Z";
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export class ImportService {
  constructor(
    private readonly mgr: DatabaseManager,
    private readonly members: MembersService,
    private readonly backups: BackupService,
    private readonly log: Logger,
    private readonly clock: Clock = systemClock,
    private readonly fetchFn: (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }> = (u, i) => fetch(u, i)
  ) {}

  private get db() {
    return this.mgr.db;
  }

  // ---- sources ----------------------------------------------------------------
  async fromSupabase(input: SupabaseImportInput): Promise<ImportSummary> {
    let base: URL;
    try {
      base = new URL(input.url.trim());
    } catch {
      throw new AppError("VALIDATION", "Enter your Supabase project URL, e.g. https://abcd1234.supabase.co");
    }
    if (base.protocol !== "https:") throw new AppError("VALIDATION", "The Supabase URL must start with https://");
    const key = input.serviceKey.trim();
    if (key.length < 20) throw new AppError("VALIDATION", "Paste the service_role key from Supabase → Project Settings → API.");

    const raw: RawTables = {};
    const warnings: string[] = [];
    for (const table of TABLES) {
      raw[table] = await this.fetchTable(base.origin, key, table, warnings);
    }
    return this.importData(raw, input.mode, warnings);
  }

  private async fetchTable(origin: string, key: string, table: string, warnings: string[]): Promise<Row[]> {
    const rows: Row[] = [];
    const page = 1000;
    for (let offset = 0; ; offset += page) {
      let res;
      try {
        res = await this.fetchFn(`${origin}/rest/v1/${table}?select=*&order=id.asc&limit=${page}&offset=${offset}`, {
          headers: { apikey: key, Authorization: `Bearer ${key}` },
        });
      } catch {
        throw new AppError("NETWORK", "Couldn't reach Supabase. Check the internet connection and the project URL.");
      }
      if (res.status === 401 || res.status === 403) throw new AppError("NETWORK", "Supabase rejected the key. Use the service_role key, not the anon key.");
      if (res.status === 404 && offset === 0) {
        warnings.push(`The "${table}" table doesn't exist in that project, so nothing was imported for it.`);
        return [];
      }
      if (!res.ok) throw new AppError("NETWORK", `Supabase returned an error (${res.status}) while reading ${table}.`);
      const batch = (await res.json()) as Row[];
      rows.push(...batch);
      if (batch.length < page) return rows;
    }
  }

  async fromFolder(dir: string, mode: ImportMode): Promise<ImportSummary> {
    const raw: RawTables = {};
    const warnings: string[] = [];
    let found = 0;
    for (const table of TABLES) {
      const json = path.join(dir, `${table}.json`);
      const csv = path.join(dir, `${table}.csv`);
      try {
        if (fs.existsSync(json)) {
          const parsed = JSON.parse(fs.readFileSync(json, "utf8")) as unknown;
          raw[table] = Array.isArray(parsed) ? (parsed as Row[]) : (((parsed as { data?: Row[] }).data ?? []) as Row[]);
          found++;
        } else if (fs.existsSync(csv)) {
          raw[table] = csvToObjects(fs.readFileSync(csv, "utf8")) as Row[];
          found++;
        } else warnings.push(`No ${table}.json or ${table}.csv in that folder — skipped.`);
      } catch {
        throw new AppError("VALIDATION", `${table} couldn't be read. Is it a valid export file?`);
      }
    }
    if (!raw.members) throw new AppError("VALIDATION", "That folder has no members.csv / members.json. Export each Supabase table into one folder and try again.");
    void found;
    return this.importData(raw, mode, warnings);
  }

  // ---- the import itself ----------------------------------------------------------
  async importData(raw: RawTables, mode: ImportMode, warnings: string[] = []): Promise<ImportSummary> {
    const backup = await this.backups.create("pre-import"); // never import over data we haven't saved first
    const now = this.clock().toISOString();
    const today = toLocalDateStr(this.clock());
    const skips = new Map<string, number>();
    const skip = (table: string, reason: string) => skips.set(`${table}|${reason}`, (skips.get(`${table}|${reason}`) ?? 0) + 1);
    const counts = { plans: 0, members: 0, renewals: 0, payments: 0, attendance: 0 };

    runInTransaction(this.db, () => {
      const db = this.db;
      if (mode === "replace") for (const t of ["attendance", "payments", "renewals", "members", "membership_plans"]) db.prepare(`DELETE FROM ${t}`).run();

      const planIds = new Set((db.prepare("SELECT id FROM membership_plans").all() as { id: number }[]).map((r) => r.id));
      const insPlan = db.prepare("INSERT OR IGNORE INTO membership_plans (id, name, duration_months, fee_paise, created_at) VALUES (?, ?, ?, ?, ?)");
      for (const r of raw.membership_plans ?? []) {
        const id = int(r.id), name = text(r.name), months = int(r.duration_months);
        if (id === null || !name || months === null || months < 1) { skip("membership_plans", "missing id, name or duration"); continue; }
        if (insPlan.run(id, name, months, Math.max(0, parseMoneyToPaise(r.fee_amount as string)), normalizeTimestamp(r.created_at) ?? now).changes) counts.plans++;
        else skip("membership_plans", "already present");
        planIds.add(id);
      }

      const memberIds = new Set((db.prepare("SELECT id FROM members").all() as { id: string }[]).map((r) => r.id));
      const insMember = db.prepare(
        `INSERT OR IGNORE INTO members (id, name, age, email, phone, plan_id, plan_name, start_date, end_date, fees_paid_paise,
           amount_due_paise, status, paused_at, notes, created_at, updated_at)
         VALUES (@id, @name, @age, @email, @phone, @plan_id, @plan_name, @start, @end, @paid, @due, @status, @paused, @notes, @created, @updated)`
      );
      let planLinksDropped = 0;
      for (const r of raw.members ?? []) {
        const id = text(r.id), name = text(r.name), start = dateOnly(r.start_date);
        if (!id || !name || !start) { skip("members", "missing id, name or start date"); continue; }
        const end = dateOnly(r.end_date);
        const paid = Math.max(0, parseMoneyToPaise(r.fees_paid as string));
        const due = blank(r.amount_due) ? paid : Math.max(0, parseMoneyToPaise(r.amount_due as string));
        const planId = int(r.plan_id);
        if (planId !== null && !planIds.has(planId)) planLinksDropped++;
        const age = int(r.age);
        const given = String(r.status);
        const created = normalizeTimestamp(r.created_at) ?? now;
        const status = computeStatus(given === "expired" || given === "paused" ? given : "active", end, today);
        const info = insMember.run({
          id, name, age: age !== null && age >= 1 && age <= 120 ? age : null, email: text(r.email), phone: text(r.phone),
          plan_id: planId !== null && planIds.has(planId) ? planId : null, plan_name: text(r.plan_name), start, end, paid, due, status,
          paused: status === "paused" ? dateOnly(r.paused_at) ?? start : null, notes: text(r.notes), created, updated: normalizeTimestamp(r.updated_at) ?? created,
        });
        if (info.changes) counts.members++;
        else skip("members", "already present");
        memberIds.add(id);
      }
      if (planLinksDropped) warnings.push(`${planLinksDropped} member(s) pointed at a plan that wasn't in the export; their plan name was kept but the link was cleared.`);

      const renewalIds = new Set((db.prepare("SELECT id FROM renewals").all() as { id: string }[]).map((r) => r.id));
      const insRenewal = db.prepare(
        `INSERT OR IGNORE INTO renewals (id, member_id, plan_id, plan_name, amount_paise, amount_due_paise, start_date, end_date, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const r of raw.renewals ?? []) {
        const id = text(r.id), memberId = text(r.member_id), start = dateOnly(r.start_date);
        if (!id || !memberId || !start) { skip("renewals", "missing id, member or start date"); continue; }
        if (!memberIds.has(memberId)) { skip("renewals", "belongs to a member that isn't in the export"); continue; }
        const planId = int(r.plan_id);
        const amount = Math.max(0, parseMoneyToPaise(r.amount as string));
        const info = insRenewal.run(id, memberId, planId !== null && planIds.has(planId) ? planId : null, text(r.plan_name), amount,
          blank(r.amount_due) ? amount : Math.max(0, parseMoneyToPaise(r.amount_due as string)), start, dateOnly(r.end_date), normalizeTimestamp(r.created_at) ?? now);
        if (info.changes) counts.renewals++;
        else skip("renewals", "already present");
        renewalIds.add(id);
      }

      const insPayment = db.prepare("INSERT OR IGNORE INTO payments (id, member_id, renewal_id, amount_paise, method, paid_at, notes) VALUES (?, ?, ?, ?, ?, ?, ?)");
      for (const r of raw.payments ?? []) {
        const id = text(r.id), memberId = text(r.member_id), renewalId = text(r.renewal_id);
        const amount = parseMoneyToPaise(r.amount as string);
        if (!id || !memberId || !renewalId || !(amount > 0)) { skip("payments", "missing id, member, term or a positive amount"); continue; }
        if (!memberIds.has(memberId) || !renewalIds.has(renewalId)) { skip("payments", "belongs to a member or term that isn't in the export"); continue; }
        const method = (PAYMENT_METHOD_VALUES as readonly string[]).includes(String(r.method)) ? String(r.method) : "other";
        if (insPayment.run(id, memberId, renewalId, amount, method, normalizeTimestamp(r.paid_at) ?? now, text(r.notes)).changes) counts.payments++;
        else skip("payments", "already present");
      }

      const insVisit = db.prepare("INSERT OR IGNORE INTO attendance (id, member_id, checked_in_at, checked_out_at, duration_minutes) VALUES (?, ?, ?, ?, ?)");
      for (const r of raw.attendance ?? []) {
        const id = text(r.id), memberId = text(r.member_id), inAt = normalizeTimestamp(r.checked_in_at);
        if (!id || !memberId || !inAt) { skip("attendance", "missing id, member or check-in time"); continue; }
        if (!memberIds.has(memberId)) { skip("attendance", "belongs to a member that isn't in the export"); continue; }
        const outAt = normalizeTimestamp(r.checked_out_at);
        const dur = outAt ? (int(r.duration_minutes) ?? minutesBetween(inAt, outAt)) : null;
        if (insVisit.run(id, memberId, inAt, outAt, dur !== null ? Math.max(0, dur) : null).changes) counts.attendance++;
        else skip("attendance", "already present or a second open visit for the same member");
      }
    });

    this.members.refreshStatuses();
    warnings.push("Staff login accounts can't be copied from Supabase (their password hashes aren't exportable). Sign in with the account you created on first launch.");
    this.log.info("Import finished", { mode, ...counts });
    return {
      ...counts,
      skipped: [...skips].map(([k, count]) => {
        const [table, reason] = k.split("|");
        return { table, count, reason };
      }),
      warnings,
      backupFile: backup.fileName,
    };
  }
}
