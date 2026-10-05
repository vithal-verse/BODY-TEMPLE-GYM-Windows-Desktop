import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { makeFull, expectCode, type Full } from "./helpers";
import { normalizeTimestamp } from "../electron/services/importer";

let env: Full;
beforeEach(async () => (env = await makeFull()));
afterEach(() => env.cleanup());

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const U3 = "33333333-3333-4333-8333-333333333333";
const R1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const R2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/** Rows shaped like Supabase/PostgREST returns them: numerics as strings, microsecond timestamps. */
const supabase = () => ({
  membership_plans: [
    { id: 1, name: "1 Month", duration_months: 1, fee_amount: "1500.00", created_at: "2026-08-01T05:00:00.123456+00:00" },
    { id: 7, name: "Annual", duration_months: 12, fee_amount: "9999.99", created_at: "2026-08-02 05:00:00+00" },
  ],
  members: [
    { id: U1, name: "Asha Rao", age: 28, email: "asha@x.com", phone: "98765 43210", plan_id: 1, plan_name: "1 Month", start_date: "2026-09-01", end_date: "2026-10-01", fees_paid: "1500.00", amount_due: "1500.00", status: "active", paused_at: null, notes: "Morning batch", created_at: "2026-09-01 04:30:00.5+00", updated_at: "2026-09-01T04:30:00.5+00:00" },
    { id: U2, name: "Bhavin Shah", age: null, plan_id: 7, plan_name: "Annual", start_date: "2026-10-01", end_date: "2027-10-01", fees_paid: "2999.99", amount_due: "9999.99", status: "active", created_at: "2026-10-01T10:00:00Z" },
    { id: U3, name: "Dropped Plan", plan_id: 42, plan_name: "Legacy", start_date: "2026-10-02", end_date: null, fees_paid: "0", status: "paused", paused_at: "2026-10-02", created_at: "2026-10-02T10:00:00Z" },
    { id: "bad-row", name: "", start_date: "2026-10-01" },
  ],
  renewals: [
    { id: R1, member_id: U1, plan_id: 1, plan_name: "1 Month", amount: "1500.00", amount_due: "1500.00", start_date: "2026-09-01", end_date: "2026-10-01", created_at: "2026-09-01T04:30:01Z" },
    { id: R2, member_id: U2, plan_id: 7, plan_name: "Annual", amount: "2999.99", start_date: "2026-10-01", end_date: "2027-10-01", created_at: "2026-10-01T10:00:01Z" },
    { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", member_id: "ghost", start_date: "2026-10-01" },
  ],
  payments: [
    { id: "p1", member_id: U1, renewal_id: R1, amount: "1500.00", method: "upi", paid_at: "2026-09-01 04:31:00.987654+00", notes: "Full" },
    { id: "p2", member_id: U2, renewal_id: R2, amount: "2999.99", method: "cheque", paid_at: "2026-10-01T10:01:00Z" },
    { id: "p3", member_id: U2, renewal_id: R2, amount: "0", method: "cash", paid_at: "2026-10-01T10:02:00Z" },
    { id: "p4", member_id: U1, renewal_id: "nope", amount: "10", method: "cash", paid_at: "2026-10-01T10:02:00Z" },
  ],
  attendance: [
    { id: "a1", member_id: U1, checked_in_at: "2026-09-02T06:00:00+00:00", checked_out_at: "2026-09-02T07:15:00+00:00", duration_minutes: 75 },
    { id: "a2", member_id: U1, checked_in_at: "2026-09-03T06:00:00+00:00", checked_out_at: "2026-09-03T06:30:00+00:00", duration_minutes: null },
    { id: "a3", member_id: U2, checked_in_at: "2026-10-03T03:00:00Z", checked_out_at: null },
    { id: "a4", member_id: "ghost", checked_in_at: "2026-10-03T03:00:00Z" },
  ],
});
const count = (t: string) => (env.mgr.db.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as { c: number }).c;

describe("normalizeTimestamp", () => {
  it("understands Postgres shapes and returns canonical ISO", () => {
    expect(normalizeTimestamp("2026-09-17 07:17:10.530904+00")).toBe("2026-09-17T07:17:10.530Z");
    expect(normalizeTimestamp("2026-09-17T07:17:10+05:30")).toBe("2026-09-17T01:47:10.000Z");
    expect(normalizeTimestamp("2026-09-17T07:17:10+0530")).toBe("2026-09-17T01:47:10.000Z");
    expect(normalizeTimestamp("2026-09-17")).toBe("2026-09-17T00:00:00.000Z");
    expect(normalizeTimestamp("2026-09-17T07:17:10")).toBe("2026-09-17T07:17:10.000Z");
    expect(normalizeTimestamp("garbage")).toBeNull();
    expect(normalizeTimestamp("")).toBeNull();
  });
});

describe("importing Supabase-shaped data", () => {
  it("keeps ids and exact money, normalises timestamps, and reports what it skipped", async () => {
    const s = await env.importer.importData(supabase() as never, "replace");
    expect(s).toMatchObject({ plans: 2, members: 3, renewals: 2, payments: 2, attendance: 3 });
    expect(s.backupFile).toMatch(/^bodytemple-pre-import-/);
    expect(env.backup.list().some((b) => b.kind === "pre-import")).toBe(true);

    const asha = env.members.get(U1)!;
    expect(asha).toMatchObject({ name: "Asha Rao", plan_id: 1, fees_paid: 1500, amount_due: 1500, notes: "Morning batch", created_at: "2026-09-01T04:30:00.500Z" });
    expect(env.members.get(U2)).toMatchObject({ fees_paid: 2999.99, amount_due: 9999.99, plan_id: 7 }); // paise-exact
    expect(env.members.get(U1)!.status).toBe("expired"); // end_date 2026-10-01 < today
    expect(env.members.get(U3)).toMatchObject({ status: "paused", plan_id: null, plan_name: "Legacy" });
    expect(env.members.payments(U2)[0]).toMatchObject({ amount: 2999.99, method: "other" }); // unknown method kept as "other"
    expect(env.members.payments(U1)[0].paid_at).toBe("2026-09-01T04:31:00.987Z");
    expect(env.attendance.memberHistory({ memberId: U1 }).map((a) => a.duration_minutes).sort()).toEqual([30, 75]); // missing duration computed

    const skippedBy = (t: string) => s.skipped.filter((k) => k.table === t).reduce((n, k) => n + k.count, 0);
    expect([skippedBy("members"), skippedBy("renewals"), skippedBy("payments"), skippedBy("attendance")]).toEqual([1, 1, 2, 1]);
    expect(s.warnings.join(" ")).toMatch(/plan that wasn't in the export/);
    expect(s.warnings.join(" ")).toMatch(/Staff login accounts/);
  });

  it("merge mode is idempotent and never overwrites existing rows; replace mode starts clean", async () => {
    await env.importer.importData(supabase() as never, "replace");
    env.members.update(U1, { name: "Edited locally", start_date: "2026-09-01", end_date: "2026-10-01", plan_id: 1, amount_due: 1500 });
    const again = await env.importer.importData(supabase() as never, "merge");
    expect([again.plans, again.members, again.renewals, again.payments, again.attendance]).toEqual([0, 0, 0, 0, 0]);
    expect(env.members.get(U1)!.name).toBe("Edited locally");
    expect(count("members")).toBe(3);

    await env.importer.importData({ members: [{ id: "x1", name: "Only One", start_date: "2026-10-03" }] } as never, "replace");
    expect(count("members")).toBe(1);
    expect(count("membership_plans")).toBe(0);
  });

  it("leaves admin accounts and settings alone", async () => {
    await env.auth.setup({ full_name: "Owner", email: "o@x.com", password: "Str0ng-pass!" });
    await env.importer.importData(supabase() as never, "replace");
    expect(count("admin_profiles")).toBe(1);
    expect(env.auth.current()).not.toBeNull();
  });
});

describe("reading from Supabase over REST", () => {
  const tables = supabase() as Record<string, unknown[]>;
  const fake = (over: Partial<Record<string, { status: number } | unknown[]>> = {}) =>
    async (url: string, init?: { headers?: Record<string, string> }) => {
      expect(init?.headers?.apikey).toBe("k".repeat(40));
      const u = new URL(url);
      const table = u.pathname.split("/").pop()!;
      const given = over[table];
      if (given && !Array.isArray(given)) return { ok: false, status: given.status, json: async () => ({}) };
      const rows = (given as unknown[] | undefined) ?? tables[table] ?? [];
      const off = Number(u.searchParams.get("offset")), lim = Number(u.searchParams.get("limit"));
      return { ok: true, status: 200, json: async () => rows.slice(off, off + lim) };
    };
  const input = { url: "https://abcd.supabase.co/", serviceKey: "k".repeat(40), mode: "replace" as const };

  it("pages through large tables and tolerates a missing table", async () => {
    const big = Array.from({ length: 1005 }, (_, i) => ({ id: `m-${String(i).padStart(4, "0")}`, name: `Member ${i}`, start_date: "2026-10-01", end_date: "2026-12-01", fees_paid: "0" }));
    const e = await makeFull({ fetchFn: undefined });
    try {
      const svc = new (await import("../electron/services/importer")).ImportService(e.mgr, e.members, e.backup, { debug() {}, info() {}, warn() {}, error() {} }, e.clock, fake({ members: big, attendance: { status: 404 } }) as never);
      const s = await svc.fromSupabase(input);
      expect(s.members).toBe(1005);
      expect(s.warnings.join(" ")).toMatch(/"attendance" table doesn't exist/);
    } finally {
      e.cleanup();
    }
  });

  it("gives friendly errors for a wrong key, an insecure URL and an offline machine", async () => {
    const mk = async (fetchFn: unknown) => {
      const e = await makeFull();
      return { e, svc: new (await import("../electron/services/importer")).ImportService(e.mgr, e.members, e.backup, { debug() {}, info() {}, warn() {}, error() {} }, e.clock, fetchFn as never) };
    };
    const a = await mk(fake({ members: { status: 401 } }));
    await expectCode(() => a.svc.fromSupabase(input), "NETWORK");
    await expectCode(() => a.svc.fromSupabase({ ...input, url: "http://abcd.supabase.co" }), "VALIDATION");
    await expectCode(() => a.svc.fromSupabase({ ...input, serviceKey: "short" }), "VALIDATION");
    a.e.cleanup();
    const b = await mk(async () => { throw new Error("offline"); });
    await expectCode(() => b.svc.fromSupabase(input), "NETWORK");
    b.e.cleanup();
  });
});

describe("reading an exported folder", () => {
  it("imports Supabase CSV exports (quoted commas, empty cells)", async () => {
    const dir = path.join(env.dir, "export");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "members.csv"), [
      "id,name,age,email,phone,plan_id,plan_name,start_date,end_date,fees_paid,amount_due,status,paused_at,notes,created_at,updated_at",
      `${U1},"Rao, Asha",28,,,1,1 Month,2026-10-01,2026-11-01,1500.00,1500.00,active,,"Likes ""early"" slots",2026-10-01 04:30:00+00,2026-10-01 04:30:00+00`,
    ].join("\n"));
    fs.writeFileSync(path.join(dir, "payments.json"), JSON.stringify({ data: [] }));
    const s = await env.importer.fromFolder(dir, "merge");
    expect(s.members).toBe(1);
    expect(env.members.get(U1)).toMatchObject({ name: "Rao, Asha", email: null, notes: 'Likes "early" slots', fees_paid: 1500 });
    expect(s.warnings.join(" ")).toMatch(/No renewals/);
  });

  it("explains what's missing when the folder has no members file", async () => {
    const dir = path.join(env.dir, "empty");
    fs.mkdirSync(dir);
    await expectCode(() => env.importer.fromFolder(dir, "merge"), "VALIDATION");
  });
});
