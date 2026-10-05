import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeEnv, expectCode, D, type Env } from "./helpers";

let env: Env;
let a: string;
let b: string;
beforeEach(async () => {
  env = await makeEnv(D(2026, 10, 3, 9, 0));
  a = env.members.create({ name: "Asha Rao", start_date: "2026-10-01", plan_id: 1 }).id;
  b = env.members.create({ name: "Bhavin Shah", start_date: "2026-10-01", plan_id: 1 }).id;
});
afterEach(() => env.cleanup());

describe("check-in / check-out", () => {
  it("checks in, blocks a duplicate active visit, then allows a new one after check-out", async () => {
    const s = env.attendance.checkIn(a);
    expect(s).toMatchObject({ member_id: a, checked_out_at: null, duration_minutes: null });
    const dup = await expectCode(() => env.attendance.checkIn(a), "ALREADY_CHECKED_IN");
    expect(dup.message).toContain("Asha Rao");
    env.advance(45 * 60_000);
    expect(env.attendance.checkOut(s.id)).toMatchObject({ duration_minutes: 45 });
    expect(() => env.attendance.checkIn(a)).not.toThrow();
  });

  it("handles invalid ids and double check-outs", async () => {
    await expectCode(() => env.attendance.checkIn("no-such-member"), "NOT_FOUND");
    await expectCode(() => env.attendance.checkOut("no-such-visit"), "NOT_FOUND");
    const s = env.attendance.checkIn(a);
    env.attendance.checkOut(s.id);
    await expectCode(() => env.attendance.checkOut(s.id), "CONFLICT");
  });

  it("lets expired or paused members check in (the UI only warns)", () => {
    env.members.pause(b);
    expect(() => env.attendance.checkIn(b)).not.toThrow();
  });
});

describe("views and statistics", () => {
  it("separates 'on the floor' from today's totals and averages completed visits", () => {
    const v1 = env.attendance.checkIn(a);
    env.advance(30 * 60_000);
    env.attendance.checkOut(v1.id);
    const v2 = env.attendance.checkIn(b);
    env.advance(60 * 60_000);
    env.attendance.checkOut(v2.id);
    env.attendance.checkIn(a);
    expect(env.attendance.stats()).toEqual({ todaysCheckInCount: 3, currentlyCheckedInCount: 1, todaysCheckoutCount: 2, averageDurationMinutesToday: 45 });
    expect(env.attendance.active().map((x) => x.member.name)).toEqual(["Asha Rao"]);
  });

  it("keeps a forgotten check-in from yesterday visible as 'on the floor' but not in today's counts", () => {
    env.set(D(2026, 10, 2, 18, 0));
    env.attendance.checkIn(a);
    env.set(D(2026, 10, 3, 9, 0));
    expect(env.attendance.active()).toHaveLength(1);
    expect(env.attendance.stats()).toMatchObject({ todaysCheckInCount: 0, currentlyCheckedInCount: 1, averageDurationMinutesToday: null });
  });

  it("history filters by name and local date range, newest first, 20 per page", () => {
    for (let day = 1; day <= 3; day++) {
      env.set(D(2026, 10, day, 8, 0));
      for (const id of [a, b]) env.attendance.checkOut(env.attendance.checkIn(id).id);
    }
    expect(env.attendance.history({}).total).toBe(6);
    expect(env.attendance.history({ query: "bhav" }).rows.every((r) => r.member.name === "Bhavin Shah")).toBe(true);
    const ranged = env.attendance.history({ startDate: "2026-10-02", endDate: "2026-10-02" });
    expect(ranged.total).toBe(2);
    const first = env.attendance.history({ pageSize: 4 });
    expect(first.rows).toHaveLength(4);
    expect(first.rows[0].session.checked_in_at >= first.rows[3].session.checked_in_at).toBe(true);
    expect(env.attendance.history({ pageSize: 4, page: 2 }).rows).toHaveLength(2);
    expect(env.attendance.memberHistory({ memberId: a, limit: 2 })).toHaveLength(2);
  });

  it("trend returns the 14 / 8 / 6 bucket series", () => {
    env.attendance.checkIn(a);
    const t = env.attendance.trend();
    expect([t.daily.length, t.weekly.length, t.monthly.length]).toEqual([14, 8, 6]);
    expect(t.daily[13].count).toBe(1);
    expect(t.monthly[5].count).toBe(1);
  });
});
