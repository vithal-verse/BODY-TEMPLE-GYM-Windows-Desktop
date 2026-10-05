import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { makeFull, expectCode, type Full } from "./helpers";

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const SHEET_ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
const EMAIL = "sync@bodytemple.iam.gserviceaccount.com";

/** A tiny in-memory Google: OAuth token endpoint + the handful of Sheets endpoints the app uses. */
function fakeGoogle() {
  const g = {
    tabs: [] as string[], values: [] as unknown[][], header: [] as unknown[], calls: [] as string[],
    jwtClaims: null as null | Record<string, unknown>, jwtValid: false, failWith: null as null | number | "network",
  };
  const fetchFn = async (url: string, init?: { method?: string; body?: string }) => {
    g.calls.push(`${init?.method ?? "GET"} ${url.replace(/^https:\/\/[^/]+/, "")}`);
    if (g.failWith === "network") throw new Error("offline");
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      const jwt = new URLSearchParams(init!.body).get("assertion")!;
      const [h, c, s] = jwt.split(".");
      g.jwtValid = crypto.createVerify("RSA-SHA256").update(`${h}.${c}`).verify(publicKey, Buffer.from(s, "base64url"));
      g.jwtClaims = JSON.parse(Buffer.from(c, "base64url").toString());
      return ok({ access_token: "tok", expires_in: 3600 });
    }
    if (typeof g.failWith === "number") return { ok: false, status: g.failWith, json: async () => ({}), text: async () => "" };
    const path = url.replace(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}`, "");
    const body = init?.body ? JSON.parse(init.body) : null;
    if (path.startsWith("?fields")) return ok({ properties: { title: "Gym sheet" }, sheets: g.tabs.map((t) => ({ properties: { title: t } })) });
    if (path === ":batchUpdate") { g.tabs.push(body.requests[0].addSheet.properties.title); return ok({}); }
    if (path.includes("A1:K1")) { g.header = body.values[0]; return ok({}); }
    if (path.includes(":clear")) { g.values = []; return ok({}); }
    if (path.includes("A2:K") && init?.method === "PUT") { expect(path).toContain("valueInputOption=RAW"); g.values = body.values; return ok({}); }
    if (path.includes("A2:K")) return ok({ values: g.values });
    throw new Error("unexpected call " + url);
  };
  return { g, fetchFn };
}

let env: Full;
let google: ReturnType<typeof fakeGoogle>;
beforeEach(async () => {
  google = fakeGoogle();
  env = await makeFull({ fetchFn: google.fetchFn });
  env.sheets.saveConfig({ spreadsheetId: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=0`, clientEmail: EMAIL, privateKey: PEM, autoSync: false });
});
afterEach(() => { vi.useRealTimers(); env.cleanup(); });

const add = (name: string, extra: Record<string, unknown> = {}) =>
  env.members.create({ name, start_date: "2026-10-03", plan_id: 1, amount_due: 1500, initial_payment: 1500, ...extra } as never);

describe("configuration and secrets", () => {
  it("extracts the id from a pasted URL and stores the private key encrypted, never in plaintext", () => {
    const cfg = env.sheets.getConfig();
    expect(cfg).toMatchObject({ spreadsheetId: SHEET_ID, clientEmail: EMAIL, hasPrivateKey: true, autoSync: false });
    const stored = JSON.stringify(env.mgr.db.prepare("SELECT value FROM app_settings").all());
    expect(stored).toContain("enc:");
    expect(stored).not.toContain("BEGIN PRIVATE KEY");
    expect(JSON.stringify(cfg)).not.toContain("PRIVATE KEY");
  });

  it("accepts a whole pasted service-account JSON file and rejects unusable keys", () => {
    const json = JSON.stringify({ client_email: "other@x.iam.gserviceaccount.com", private_key: PEM });
    expect(env.sheets.saveConfig({ spreadsheetId: SHEET_ID, clientEmail: "", privateKey: json, autoSync: true }).clientEmail).toBe("other@x.iam.gserviceaccount.com");
    expect(() => env.sheets.saveConfig({ spreadsheetId: SHEET_ID, clientEmail: EMAIL, privateKey: "not a key", autoSync: false })).toThrow(/private key/i);
    expect(() => env.sheets.saveConfig({ spreadsheetId: "bad id!", clientEmail: EMAIL, autoSync: false })).toThrow(/spreadsheet ID/i);
  });
});

describe("push (database -> sheet)", () => {
  it("signs a valid service-account JWT, creates the Members tab and writes header + rows as RAW text", async () => {
    add("Asha Rao", { phone: "+91 98765 43210" });
    add("=SUM(1,1)");
    const r = await env.sheets.push();
    expect(r).toEqual({ synced: 2 });
    expect(google.g.jwtValid).toBe(true);
    expect(google.g.jwtClaims).toMatchObject({ iss: EMAIL, aud: "https://oauth2.googleapis.com/token", scope: "https://www.googleapis.com/auth/spreadsheets" });
    expect(google.g.tabs).toContain("Members");
    expect(google.g.header).toEqual(["id", "name", "age", "email", "phone", "plan_name", "start_date", "end_date", "fees_paid", "status", "updated_at"]);
    expect(google.g.values).toHaveLength(2);
    expect(google.g.values[0].slice(1, 10)).toEqual(["Asha Rao", "", "", "+91 98765 43210", "1 Month", "2026-10-03", "2026-11-03", 1500, "active"]);
    expect(google.g.values[1][1]).toBe("=SUM(1,1)"); // stays text because it is written RAW
    expect(env.sheets.getConfig().lastPushAt).not.toBeNull();
  });

  it("reuses the access token across calls", async () => {
    await env.sheets.push();
    await env.sheets.push();
    expect(google.g.calls.filter((c) => c.includes("/token")).length).toBe(1);
  });

  it("explains failures in plain language and records them, without touching local data", async () => {
    add("Asha");
    google.g.failWith = "network";
    await expectCode(() => env.sheets.push(), "NETWORK");
    expect(env.sheets.getConfig().lastError).toMatch(/internet/i);
    google.g.failWith = 403;
    const e = await expectCode(() => env.sheets.push(), "NETWORK");
    expect(e.message).toMatch(/share the spreadsheet/i);
    expect(env.members.list().total).toBe(1);
  });

  it("auto-sync pushes in the background shortly after a change", async () => {
    env.sheets.saveConfig({ spreadsheetId: SHEET_ID, clientEmail: EMAIL, autoSync: true });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    add("Asha");
    add("Bhavin"); // debounced: still a single push
    expect(google.g.values).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(4500);
    await vi.waitFor(() => expect(google.g.values).toHaveLength(2));
  });
});

describe("pull (sheet -> database)", () => {
  it("applies sheet edits to rows that are still in sync, then refreshes the sheet", async () => {
    const m = add("Asha Rao", { age: 30 });
    await env.sheets.push();
    google.g.values[0][1] = "Asha R. Rao";
    google.g.values[0][2] = 31;
    google.g.values[0][8] = 2500;
    google.g.values[0][9] = "paused";
    const r = await env.sheets.pull();
    expect(r).toMatchObject({ updatedMembers: 1, fieldsChanged: 4, conflictsSkipped: 0, invalidSkipped: 0 });
    expect(env.members.get(m.id)).toMatchObject({ name: "Asha R. Rao", age: 31, fees_paid: 2500, status: "paused" });
    expect(google.g.values[0][10]).toBe(env.members.get(m.id)!.updated_at); // sheet refreshed after the pull
    expect((await env.sheets.pull()).updatedMembers).toBe(0); // and the next pull is a no-op
  });

  it("local wins when the member changed in the app after the last push", async () => {
    const m = add("Asha Rao");
    await env.sheets.push();
    env.advance(60_000);
    env.members.update(m.id, { name: "Asha (edited in app)", start_date: "2026-10-03", end_date: "2026-11-03", plan_id: 1, amount_due: 1500 });
    google.g.values[0][1] = "Edited in sheet";
    const r = await env.sheets.pull();
    expect(r).toMatchObject({ updatedMembers: 0, conflictsSkipped: 1 });
    expect(env.members.get(m.id)!.name).toBe("Asha (edited in app)");
  });

  it("skips invalid cell edits and rows it doesn't know", async () => {
    const m = add("Asha Rao");
    await env.sheets.push();
    google.g.values[0][2] = "abc"; // age
    google.g.values[0][6] = "31/12/2026"; // date
    google.g.values[0][9] = "vip"; // status
    google.g.values.push(["ghost-id", "Ghost", "", "", "", "", "2026-10-03", "", 0, "active", "x"]);
    const r = await env.sheets.pull();
    expect(r).toMatchObject({ updatedMembers: 0, invalidSkipped: 3 });
    expect(env.members.get(m.id)).toMatchObject({ age: null, start_date: "2026-10-03", status: "active" });
  });
});
