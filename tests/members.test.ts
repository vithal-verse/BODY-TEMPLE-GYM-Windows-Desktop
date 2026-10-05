import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeEnv, expectCode, D, type Env } from "./helpers";
import { addMonthsStr, addDaysStr, diffDays } from "../electron/services/util";

let env: Env;
beforeEach(async () => (env = await makeEnv())); // "today" = 2026-10-03
afterEach(() => env.cleanup());

const mk = (over: Record<string, unknown> = {}) =>
  env.members.create({ name: "Asha Rao", start_date: "2026-10-03", plan_id: 1, amount_due: 1500, initial_payment: 1000, payment_method: "upi", ...over } as never);
const count = (t: string) => (env.mgr.db.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as { c: number }).c;

describe("date helpers", () => {
  it("clamps month-end like date-fns and handles day math", () => {
    expect(addMonthsStr("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsStr("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonthsStr("2026-11-15", 3)).toBe("2027-02-15");
    expect(addDaysStr("2026-12-30", 3)).toBe("2027-01-02");
    expect(diffDays("2026-10-03", "2026-10-08")).toBe(5);
  });
});

describe("create", () => {
  it("creates the member, its first term and the first payment together", () => {
    const m = mk();
    expect(m).toMatchObject({ name: "Asha Rao", plan_name: "1 Month", end_date: "2026-11-03", fees_paid: 1000, amount_due: 1500, status: "active", paused_at: null });
    const r = env.members.renewals(m.id);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ amount: 1000, amount_due: 1500, start_date: "2026-10-03", end_date: "2026-11-03", plan_name: "1 Month" });
    const p = env.members.payments(m.id);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ amount: 1000, method: "upi", renewal_id: r[0].id });
    expect(env.changes.count).toBeGreaterThan(0);
  });

  it("writes no payment row when nothing was collected, but still records the term", () => {
    const m = mk({ initial_payment: 0 });
    expect(env.members.payments(m.id)).toHaveLength(0);
    expect(env.members.renewals(m.id)).toHaveLength(1);
    expect(m.fees_paid).toBe(0);
  });

  it("is all-or-nothing: a bad plan or blank name leaves nothing behind", async () => {
    await expectCode(() => mk({ plan_id: 999 }), "VALIDATION");
    await expectCode(() => mk({ name: "   " }), "VALIDATION");
    expect([count("members"), count("renewals"), count("payments")]).toEqual([0, 0, 0]);
  });

  it("marks an already-lapsed membership expired immediately", () => {
    expect(mk({ start_date: "2026-08-01", end_date: "2026-09-01" }).status).toBe("expired");
  });
});

describe("edit", () => {
  it("corrects details and amount due without touching fees paid or term history", () => {
    const m = mk();
    const u = env.members.update(m.id, { name: "Asha R.", phone: "+91 98765 43210", plan_id: 2, start_date: "2026-10-03", end_date: "2026-12-03", amount_due: 2000, age: 31 });
    expect(u).toMatchObject({ name: "Asha R.", phone: "+91 98765 43210", plan_name: "2 Months", amount_due: 2000, fees_paid: 1000, age: 31 });
    expect(env.members.renewals(m.id)).toHaveLength(1);
    expect(env.members.payments(m.id)).toHaveLength(1);
  });

  it("moving the end date re-evaluates expired/active (paused is left alone)", () => {
    const m = mk();
    const base = { name: m.name, plan_id: 1, start_date: "2026-10-03", amount_due: 1500 };
    expect(env.members.update(m.id, { ...base, end_date: "2026-10-01" }).status).toBe("expired");
    expect(env.members.update(m.id, { ...base, end_date: "2026-12-01" }).status).toBe("active");
    env.members.pause(m.id);
    expect(env.members.update(m.id, { ...base, end_date: "2026-09-01" }).status).toBe("paused");
  });

  it("reports unknown members", async () => {
    await expectCode(() => env.members.update("nope", { name: "x", start_date: "2026-10-03" }), "NOT_FOUND");
  });
});

describe("list: search / filter / sort / paginate", () => {
  beforeEach(() => {
    mk({ name: "Asha Rao", phone: "98765 11111", email: "asha@x.com", end_date: "2026-10-03" }); // ends today
    mk({ name: "bhavin shah", phone: "99999 22222", end_date: "2026-10-10" }); // +7 days
    mk({ name: "Chirag Patel", end_date: "2026-10-11" }); // +8 days
    mk({ name: "Divya Nair", initial_payment: 3000, end_date: "2026-12-01" });
    const e = mk({ name: "Esha Gupta", initial_payment: 200 });
    env.members.pause(e.id);
  });

  it("searches name, email and phone case-insensitively; wildcards are literal", () => {
    expect(env.members.list({ query: "RAO" }).rows.map((m) => m.name)).toEqual(["Asha Rao"]);
    expect(env.members.list({ query: "asha@x" }).total).toBe(1);
    expect(env.members.list({ query: "99999" }).rows[0].name).toBe("bhavin shah");
    expect(env.members.list({ query: "%" }).total).toBe(0);
  });

  it("filters by status, including 'expiring' = active and ending within 7 days", () => {
    expect(env.members.list({ status: "paused" }).rows.map((m) => m.name)).toEqual(["Esha Gupta"]);
    expect(env.members.list({ status: "expiring", sortKey: "end_date" }).rows.map((m) => m.name)).toEqual(["Asha Rao", "bhavin shah"]);
    expect(env.members.list({ status: "active" }).total).toBe(4);
  });

  it("sorts (case-insensitively by name) and paginates server-side", () => {
    expect(env.members.list({ pageSize: 10 }).rows.map((m) => m.name)).toEqual(["Asha Rao", "bhavin shah", "Chirag Patel", "Divya Nair", "Esha Gupta"]);
    expect(env.members.list({ sortDir: "desc", pageSize: 2 }).rows.map((m) => m.name)).toEqual(["Esha Gupta", "Divya Nair"]);
    const p2 = env.members.list({ pageSize: 2, page: 2 });
    expect(p2).toMatchObject({ total: 5, page: 2, pageSize: 2 });
    expect(p2.rows.map((m) => m.name)).toEqual(["Chirag Patel", "Divya Nair"]);
    expect(env.members.list({ sortKey: "fees_paid", sortDir: "desc", pageSize: 1 }).rows[0].name).toBe("Divya Nair");
  });
});

describe("status follows the calendar", () => {
  it("flips active -> expired as days pass (no edit needed) and renewal revives it", () => {
    const m = mk({ end_date: "2026-10-05" });
    expect(env.members.get(m.id)?.status).toBe("active");
    env.set(D(2026, 10, 6));
    expect(env.members.get(m.id)?.status).toBe("expired");
    expect(env.members.list({ status: "expired" }).total).toBe(1);
    expect(env.dashboard.stats()).toMatchObject({ activeMembers: 0, expiredMembers: 1 });
    expect(env.members.renew(m.id, { plan_id: 1, start_date: "2026-10-06", paid_now: 0 }).status).toBe("active");
  });

  it("never expires a paused membership", () => {
    const m = mk({ end_date: "2026-10-05" });
    env.members.pause(m.id);
    env.set(D(2026, 12, 1));
    expect(env.members.get(m.id)?.status).toBe("paused");
  });
});

describe("renew", () => {
  it("starts a fresh term: resets the running total, keeps history, clears pause", () => {
    const m = mk();
    env.members.pause(m.id);
    env.advance(2 * 86_400_000);
    const r = env.members.renew(m.id, { plan_id: 3, start_date: "2026-11-03", paid_now: 1200, method: "cash" });
    expect(r).toMatchObject({ plan_name: "3 Months", start_date: "2026-11-03", end_date: "2027-02-03", amount_due: 2500, fees_paid: 1200, status: "active", paused_at: null });
    const terms = env.members.renewals(m.id);
    expect(terms.map((t) => t.start_date)).toEqual(["2026-11-03", "2026-10-03"]);
    expect(env.members.currentRenewal(m.id)).toMatchObject({ amount: 1200, amount_due: 2500, plan_name: "3 Months" });
    expect(env.members.payments(m.id).reduce((s, p) => s + p.amount, 0)).toBe(2200); // 1000 old + 1200 new
  });

  it("is atomic: an invalid plan changes nothing", async () => {
    const m = mk();
    await expectCode(() => env.members.renew(m.id, { plan_id: 999, start_date: "2026-11-03", paid_now: 500 }), "VALIDATION");
    expect(env.members.get(m.id)).toMatchObject({ fees_paid: 1000, plan_name: "1 Month" });
    expect([count("renewals"), count("payments")]).toEqual([1, 1]);
  });
});

describe("record payment", () => {
  it("adds to the member's running total and to the current term", () => {
    const m = mk();
    const after = env.members.recordPayment(m.id, { amount: 500, method: "cash", notes: " balance " });
    expect(after.fees_paid).toBe(1500);
    expect(env.members.currentRenewal(m.id)?.amount).toBe(1500);
    expect(env.members.payments(m.id)[0]).toMatchObject({ amount: 500, method: "cash", notes: "balance" });
  });

  it("rejects zero amounts and members with no term yet", async () => {
    const m = mk();
    await expectCode(() => env.members.recordPayment(m.id, { amount: 0, method: "cash" }), "VALIDATION");
    env.mgr.db.prepare("DELETE FROM payments").run();
    env.mgr.db.prepare("DELETE FROM renewals").run();
    await expectCode(() => env.members.recordPayment(m.id, { amount: 10, method: "cash" }), "CONFLICT");
  });
});

describe("pause / resume", () => {
  it("resume extends the end date by the days paused", () => {
    const m = mk({ end_date: "2026-11-03" });
    const p = env.members.pause(m.id);
    expect(p).toMatchObject({ status: "paused", paused_at: "2026-10-03" });
    env.advance(5 * 86_400_000);
    expect(env.members.resume(m.id)).toMatchObject({ status: "active", paused_at: null, end_date: "2026-11-08" });
  });

  it("only active memberships can be paused, only paused ones resumed", async () => {
    const lapsed = mk({ end_date: "2026-09-01" });
    await expectCode(() => env.members.pause(lapsed.id), "VALIDATION");
    await expectCode(() => env.members.resume(mk({ name: "Other" }).id), "VALIDATION");
  });
});

describe("delete", () => {
  it("removes the member and everything attached to it", async () => {
    const m = mk();
    env.attendance.checkIn(m.id);
    env.members.remove(m.id);
    expect([count("members"), count("renewals"), count("payments"), count("attendance")]).toEqual([0, 0, 0, 0]);
    await expectCode(() => env.members.remove(m.id), "NOT_FOUND");
  });
});
