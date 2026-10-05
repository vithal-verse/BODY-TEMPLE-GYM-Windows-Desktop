import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeEnv, D, type Env } from "./helpers";
import { parseCsv } from "@shared/csv";

let env: Env;
beforeEach(async () => (env = await makeEnv(D(2026, 10, 3, 10, 0))));
afterEach(() => env.cleanup());

const mkAt = (when: Date, input: Parameters<Env["members"]["create"]>[0]) => {
  env.set(when);
  return env.members.create(input);
};
const monthLabel = (m: number) => new Date(2026, m - 1, 1).toLocaleDateString("en-IN", { month: "short" });

describe("dashboard", () => {
  it("matches the web app's semantics: revenue = Σ fees_paid, chart by start month, expiring within 7 days", () => {
    mkAt(D(2026, 10, 1), { name: "A", start_date: "2026-10-01", end_date: "2026-11-01", initial_payment: 1500 });
    mkAt(D(2026, 8, 15), { name: "B", start_date: "2026-08-15", end_date: "2026-10-05", initial_payment: 2000 });
    mkAt(D(2026, 5, 1), { name: "C", start_date: "2026-05-01", end_date: "2026-06-01", initial_payment: 1000 });
    mkAt(D(2026, 4, 30), { name: "D", start_date: "2026-04-30", end_date: "2026-05-30", initial_payment: 777 });
    env.set(D(2026, 10, 3, 10, 0));
    const idA = env.members.list({ query: "A", pageSize: 1 }).rows[0].id;
    env.attendance.checkIn(idA);

    const s = env.dashboard.stats();
    expect(s).toMatchObject({ totalMembers: 4, activeMembers: 2, expiredMembers: 2, totalRevenue: 5277, checkedInTodayCount: 1 });
    expect(s.expiringSoon.map((m) => m.name)).toEqual(["B"]);
    expect(s.revenueByMonth).toEqual([
      { month: monthLabel(5), revenue: 1000 }, { month: monthLabel(6), revenue: 0 }, { month: monthLabel(7), revenue: 0 },
      { month: monthLabel(8), revenue: 2000 }, { month: monthLabel(9), revenue: 0 }, { month: monthLabel(10), revenue: 1500 },
    ]);
    expect(s.checkedInToday[0].member.name).toBe("A");
  });
});

describe("revenue report", () => {
  let x: string;
  beforeEach(() => {
    mkAt(D(2026, 9, 20), { name: "Yash", start_date: "2026-09-20", plan_id: 2, amount_due: 2000, initial_payment: 2000, payment_method: "card" });
    x = mkAt(D(2026, 10, 2, 12, 0), { name: "Xavier", start_date: "2026-10-01", plan_id: 3, amount_due: 3000, initial_payment: 1000, payment_method: "cash" }).id;
    env.set(D(2026, 10, 3, 9, 0));
    env.members.recordPayment(x, { amount: 500, method: "upi" });
  });
  const oct = { startIso: D(2026, 10, 1, 0, 0).toISOString(), endIso: D(2026, 11, 1, 0, 0).toISOString() };

  it("summarises the date range: totals, average, method split, pending dues", () => {
    const r = env.revenue.report(oct);
    expect(r.summary).toEqual({ totalAmount: 1500, paymentCount: 2, averagePayment: 750, byMethod: { cash: 1000, upi: 500, card: 0, other: 0 } });
    expect(r.pendingDues).toBe(1500);
    expect(r.table.total).toBe(2);
  });

  it("table filters (method, member name), sorts and paginates without changing the cards", () => {
    const upi = env.revenue.report({ ...oct, method: "upi" });
    expect(upi.table).toMatchObject({ total: 1, filteredTotal: 500 });
    expect(upi.summary.totalAmount).toBe(1500);
    expect(env.revenue.report({ ...oct, query: "xav" }).table.total).toBe(2);
    expect(env.revenue.report({ ...oct, query: "yash" }).table.total).toBe(0);
    const asc = env.revenue.report({ ...oct, sortKey: "amount", sortDir: "asc", pageSize: 1 });
    expect(asc.table.rows[0].payment.amount).toBe(500);
    expect(env.revenue.report({ ...oct, sortKey: "amount", sortDir: "asc", pageSize: 1, page: 2 }).table.rows[0].payment.amount).toBe(1000);
    expect(env.revenue.report({ startIso: D(2026, 9, 1, 0, 0).toISOString(), endIso: D(2026, 10, 1, 0, 0).toISOString() }).summary.totalAmount).toBe(2000);
  });

  it("trend covers the three windows", () => {
    const t = env.revenue.trend();
    expect([t.daily.length, t.weekly.length, t.monthly.length]).toEqual([14, 8, 6]);
    expect(t.monthly[5].amount).toBe(1500);
    expect(t.monthly[4].amount).toBe(2000);
  });

  it("exports the filtered rows as CSV", () => {
    const f = env.exports.revenueCsv({ ...oct, method: "cash" });
    expect(f.fileName).toBe("body-temple-gym-revenue-2026-10-03.csv");
    const rows = parseCsv(f.content);
    expect(rows[0]).toEqual(["Member", "Amount", "Method", "Date", "Notes"]);
    expect(rows).toHaveLength(2);
    expect(rows[1].slice(0, 3)).toEqual(["Xavier", "1000", "cash"]);
  });
});

describe("members CSV", () => {
  it("has the 11 original columns, a BOM for Excel, and neutralises formulas but keeps +91 phones", () => {
    env.members.create({ name: "=HYPERLINK(\"http://x\")", phone: "+91 98765 43210", start_date: "2026-10-03", plan_id: 1, amount_due: 1500, initial_payment: 500 });
    const f = env.exports.members();
    expect(f.content.charCodeAt(0)).toBe(0xfeff);
    const rows = parseCsv(f.content);
    expect(rows[0]).toEqual(["Name", "Age", "Email", "Phone", "Plan", "Start date", "End date", "Amount due", "Fees paid", "Outstanding", "Status"]);
    expect(rows[1][0].startsWith("'=")).toBe(true);
    expect(rows[1][3]).toBe("+91 98765 43210");
    expect(rows[1].slice(7)).toEqual(["1500", "500", "1000", "active"]);
    expect(f.fileName).toBe("body-temple-gym-members-2026-10-03.csv");
  });
});
