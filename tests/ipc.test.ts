import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { makeFull, type Full } from "./helpers";
import { Dispatcher } from "../electron/ipc/dispatcher";
import { buildHandlers, type HandlerCtx } from "../electron/ipc/handlers";
import { toApiError } from "../electron/ipc/errors";
import { API_METHODS } from "@shared/api";
import { AppError } from "@shared/errors";
import { parseCsv } from "@shared/csv";

let env: Full;
let logs: string[];
let d: Dispatcher;
const logger = () => ({ debug() {}, info() {}, warn: (m: string) => void logs.push(m), error: (m: string) => void logs.push(m) });

beforeEach(async () => {
  logs = [];
  env = await makeFull();
  const ctx: HandlerCtx = {
    ...env,
    host: { name: "Body Temple Gym", version: "1.0.0", electron: "44", chrome: "x", node: "24", platform: "win32", dataDir: env.dir, dbPath: env.mgr.dbPath, backupDir: env.backup.dir, logDir: path.join(env.dir, "logs") },
  };
  d = new Dispatcher(ctx, logger());
});
afterEach(() => env.cleanup());

const call = async (ns: string, m: string, input?: unknown, trusted = true) => d.invoke(ns, m, input, { trusted });
const data = async <T = unknown>(ns: string, m: string, input?: unknown) => {
  const r = await call(ns, m, input);
  if (!r.ok) throw new Error(`${ns}.${m} failed: ${r.error.code} ${r.error.message}`);
  return r.data as T;
};
const errOf = async (ns: string, m: string, input?: unknown) => {
  const r = await call(ns, m, input);
  if (r.ok) throw new Error(`${ns}.${m} unexpectedly succeeded`);
  return r.error;
};
const signIn = async () => {
  await data("auth", "setup", { full_name: "Owner", email: "owner@x.com", password: "Str0ng-pass!" });
};
const addMember = (over: Record<string, unknown> = {}) =>
  data<{ id: string }>("members", "create", { name: "Asha Rao", start_date: "2026-10-03", plan_id: 1, amount_due: 1500, initial_payment: 500, payment_method: "upi", ...over });

describe("the allow-list", () => {
  it("has exactly one handler for every method the renderer can call — no more, no fewer", () => {
    const handlers = buildHandlers() as unknown as Record<string, Record<string, unknown>>;
    expect(Object.keys(handlers).sort()).toEqual(Object.keys(API_METHODS).sort());
    for (const [ns, methods] of Object.entries(API_METHODS)) {
      expect(Object.keys(handlers[ns]).sort()).toEqual([...methods].sort());
    }
  });

  it("freezes who may call what (a change here is a security review)", () => {
    const handlers = buildHandlers() as unknown as Record<string, Record<string, { access: string }>>;
    const by = (access: string) =>
      Object.entries(handlers).flatMap(([ns, ms]) => Object.entries(ms).filter(([, h]) => h.access === access).map(([m]) => `${ns}.${m}`)).sort();
    expect(by("public")).toEqual(["auth.login", "auth.logout", "auth.resetPassword", "auth.setup", "auth.status"]);
    expect(by("owner")).toEqual([
      "auth.createAdmin", "auth.removeAdmin", "backup.remove", "backup.restoreFromFile", "backup.restoreFromList",
      "importer.fromFolder", "importer.fromSupabase",
    ]);
  });
});

describe("request gatekeeping", () => {
  it("blocks requests that don't come from the app's own window, even public ones", async () => {
    const r = await call("auth", "status", undefined, false);
    expect(r).toEqual({ ok: false, error: { code: "FORBIDDEN", message: "That request was blocked." } });
    expect(logs.join()).toMatch(/Blocked auth\.status/);
  });

  it("rejects unknown actions and prototype-key probing", async () => {
    for (const [ns, m] of [["nope", "x"], ["members", "drop"], ["constructor", "constructor"], ["__proto__", "x"], ["members", "__proto__"], ["members", "toString"]]) {
      const r = await call(ns, m, {});
      expect(r.ok).toBe(false);
      expect(!r.ok && r.error.code).toBe("NOT_FOUND");
    }
  });

  it("requires a session before it even looks at the payload", async () => {
    expect((await errOf("members", "list", { pageSize: "lots" })).code).toBe("UNAUTHENTICATED");
    expect((await errOf("system", "info")).code).toBe("UNAUTHENTICATED");
    await signIn();
    expect((await errOf("members", "list", { pageSize: "lots" })).code).toBe("VALIDATION");
    await data("auth", "logout");
    expect((await errOf("members", "list", {})).code).toBe("UNAUTHENTICATED");
  });

  it("keeps owner-only actions away from regular admins", async () => {
    await signIn();
    await data("auth", "createAdmin", { full_name: "Desk", email: "desk@x.com", password: "Desk-pass-9!", role: "admin" });
    await data("auth", "logout");
    await data("auth", "login", { email: "desk@x.com", password: "Desk-pass-9!" });
    for (const [ns, m, input] of [["backup", "restoreFromList", { fileName: "x.sqlite" }], ["importer", "fromFolder", { mode: "replace" }], ["auth", "createAdmin", { full_name: "x", email: "a@b.co", password: "Passw0rd!x", role: "admin" }]] as const) {
      expect((await errOf(ns, m, input)).code).toBe("FORBIDDEN");
    }
    expect(env.platform.confirms).toEqual([]);
  });
});

describe("validation", () => {
  beforeEach(signIn);

  it("explains bad input in plain language and creates nothing", async () => {
    expect((await errOf("members", "create", { name: "  ", start_date: "2026-10-03" })).message).toBe("Name is required.");
    expect((await errOf("members", "create", { name: "A", start_date: "2026-02-30" })).message).toBe("That date doesn't exist.");
    expect((await errOf("members", "create", { name: "A", start_date: "03/10/2026" })).message).toBe("Use the date format yyyy-mm-dd.");
    expect((await errOf("members", "create", { name: "A", start_date: "2026-10-03", initial_payment: -5 })).message).toBe("Amounts can't be negative.");
    expect((await errOf("members", "create", { name: "A", start_date: "2026-10-03", age: "forty" })).message).toBe('The value for "age" isn\'t valid.');
    expect((await data<{ total: number }>("members", "list", {})).total).toBe(0);
  });

  it("refuses injection-style and out-of-range query parameters", async () => {
    await addMember();
    expect((await errOf("members", "list", { sortKey: "name; DROP TABLE members;--" })).code).toBe("VALIDATION");
    expect((await errOf("members", "list", { sortDir: "asc; DELETE FROM members" })).code).toBe("VALIDATION");
    expect((await errOf("members", "list", { pageSize: 10_000_000 })).code).toBe("VALIDATION");
    // a hostile search term is just text
    expect((await data<{ total: number }>("members", "list", { query: "'; DROP TABLE members;--" })).total).toBe(0);
    expect((await data<{ total: number }>("members", "list", {})).total).toBe(1);
  });

  it("strips fields the form never offers, so they can't be smuggled into the database", async () => {
    const m = await addMember({ fees_paid_paise: 99_999_999, fees_paid: 99999, status: "paused", id: "forced-id", created_at: "1999-01-01" });
    const got = await data<{ id: string; fees_paid: number; status: string; created_at: string }>("members", "get", { id: m.id });
    expect(got.id).not.toBe("forced-id");
    expect(got.fees_paid).toBe(500);
    expect(got.status).toBe("active");
    expect(got.created_at.startsWith("2026")).toBe(true);
  });
});

describe("a normal working session through the same pipeline the UI uses", () => {
  it("runs first-run setup → member → payment → check-in/out → dashboard", async () => {
    expect(await data("auth", "status")).toEqual({ hasAdmin: false, session: null });
    const setup = await data<{ recoveryCode: string; session: { role: string } }>("auth", "setup", { full_name: "Vithal", email: "owner@x.com", password: "Str0ng-pass!" });
    expect(setup.session.role).toBe("owner");
    expect(setup.recoveryCode).toMatch(/^([A-Z2-9]{4}-){4}[A-Z2-9]{4}$/);
    expect((await errOf("auth", "setup", { full_name: "Evil", email: "e@x.com", password: "Str0ng-pass!" })).code).toBe("CONFLICT");

    const m = await addMember();
    await data("members", "recordPayment", { id: m.id, input: { amount: 1000, method: "cash" } });
    const visit = await data<{ id: string }>("attendance", "checkIn", { memberId: m.id });
    expect((await errOf("attendance", "checkIn", { memberId: m.id })).code).toBe("ALREADY_CHECKED_IN");
    env.advance(50 * 60_000);
    await data("attendance", "checkOut", { sessionId: visit.id });

    const stats = await data<{ totalMembers: number; totalRevenue: number; checkedInTodayCount: number }>("dashboard", "stats");
    expect(stats).toMatchObject({ totalMembers: 1, totalRevenue: 1500, checkedInTodayCount: 1 });
    expect(await data("attendance", "stats")).toMatchObject({ averageDurationMinutesToday: 50 });
    const report = await data<{ summary: { totalAmount: number } }>("revenue", "report", { startIso: "2026-10-01T00:00:00.000Z", endIso: "2026-11-01T00:00:00.000Z" });
    expect(report.summary.totalAmount).toBe(1500);
  });
});

describe("actions that open dialogs", () => {
  beforeEach(signIn);

  it("writes the CSV where the user chose, and does nothing when they cancel", async () => {
    await addMember({ name: "Asha, Rao" });
    const dest = path.join(env.dir, "members.csv");
    env.platform.nextSave = dest;
    expect(await data("exports", "members")).toEqual({ done: true, path: dest });
    const rows = parseCsv(fs.readFileSync(dest, "utf8"));
    expect(rows[1][0]).toBe("Asha, Rao");
    env.platform.nextSave = null;
    expect(await data("exports", "members")).toEqual({ done: false });
  });

  it("restore asks for confirmation first; 'no' changes nothing, 'yes' restores and ends the session", async () => {
    await addMember({ name: "Before" });
    const snap = await data<{ fileName: string }>("backup", "create");
    await addMember({ name: "After" });

    env.platform.confirmAnswer = false;
    expect(await data("backup", "restoreFromList", { fileName: snap.fileName })).toEqual({ done: false });
    expect(env.platform.confirms).toEqual(["Replace all current data?"]);
    expect((await data<{ total: number }>("members", "list", {})).total).toBe(2);

    env.platform.confirmAnswer = true;
    expect(await data("backup", "restoreFromList", { fileName: snap.fileName })).toMatchObject({ done: true });
    expect(env.invalidated).toEqual(["restored"]);
    expect((await errOf("members", "list", {})).code).toBe("UNAUTHENTICATED"); // staff accounts came back with the backup; sign in again
  });

  it("restoring from a chosen file verifies it before bothering the user", async () => {
    const junk = path.join(env.dir, "junk.sqlite");
    fs.writeFileSync(junk, "not a database ".repeat(40));
    env.platform.nextOpen = junk;
    const e = await errOf("backup", "restoreFromFile");
    expect(e.code).toBe("VALIDATION");
    expect(env.platform.confirms).toEqual([]);
  });

  it("an import that replaces data needs confirmation; cancelling the folder picker is a no-op", async () => {
    env.platform.nextFolder = null;
    expect(await data("importer", "fromFolder", { mode: "replace" })).toBeNull();
    env.platform.nextFolder = env.dir;
    env.platform.confirmAnswer = false;
    expect(await data("importer", "fromFolder", { mode: "replace" })).toBeNull();
    expect((await errOf("importer", "fromSupabase", { url: "https://x.supabase.co", serviceKey: "k".repeat(40), mode: "replace" })).message).toMatch(/cancelled/i);
  });

  it("reports system info", async () => {
    expect(await data("system", "info")).toMatchObject({ name: "Body Temple Gym", schemaVersion: 1, dataDir: env.dir });
  });
});

describe("error translation", () => {
  const log = logger();
  it("maps SQLite failures to friendly messages and never leaks internals", () => {
    const sqlite = (code: string) => Object.assign(new Error("UNIQUE constraint failed: members.secret_column"), { code });
    expect(toApiError(sqlite("SQLITE_CONSTRAINT_UNIQUE"), log, "t")).toEqual({ code: "CONFLICT", message: "That already exists." });
    expect(toApiError(sqlite("SQLITE_FULL"), log, "t").message).toMatch(/disk is full/);
    expect(toApiError(sqlite("SQLITE_CORRUPT"), log, "t").message).toMatch(/Restore a backup/);
    expect(toApiError(sqlite("SQLITE_SOMETHING_NEW"), log, "t").code).toBe("DATABASE");
    const unknown = toApiError(new TypeError("Cannot read properties of undefined (reading 'password')"), log, "t");
    expect(unknown).toEqual({ code: "UNKNOWN", message: "Something went wrong. The details were saved to the log file." });
    expect(toApiError(new AppError("VALIDATION", "Nope."), log, "t")).toEqual({ code: "VALIDATION", message: "Nope." });
  });

  it("logs technical failures (redacted) but not ordinary validation problems", async () => {
    await signIn();
    logs.length = 0;
    await errOf("members", "create", { name: "", start_date: "2026-10-03" });
    expect(logs).toEqual([]);
    env.mgr.db.exec("DROP TABLE payments"); // simulate a damaged database
    await errOf("members", "payments", { memberId: "x" });
    expect(logs.length).toBeGreaterThan(0);
  });
});
