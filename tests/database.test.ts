import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseManager } from "../electron/database/manager";
import { integrityCheck, currentVersion } from "../electron/database/migrate";
import { MIGRATIONS, LATEST_SCHEMA_VERSION } from "../electron/database/migrations";
import { nullLogger } from "../electron/services/logger";
import { AppError } from "@shared/errors";

let dir: string;
let mgr: DatabaseManager;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "btg-db-"));
  mgr = new DatabaseManager(path.join(dir, "nested", "gym.sqlite"), nullLogger);
  await mgr.open();
});

afterEach(() => {
  mgr.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function addMember(over: Record<string, unknown> = {}) {
  const id = randomUUID();
  mgr.db
    .prepare(
      `INSERT INTO members (id, name, start_date, end_date, status)
       VALUES (@id, @name, @start_date, @end_date, @status)`
    )
    .run({ id, name: "Test Member", start_date: "2026-10-01", end_date: "2026-11-01", status: "active", ...over });
  return id;
}

describe("database initialisation", () => {
  it("creates the directory + file on first launch and applies the latest schema", () => {
    expect(fs.existsSync(mgr.dbPath)).toBe(true);
    expect(mgr.schemaVersion).toBe(LATEST_SCHEMA_VERSION);
    const tables = (
      mgr.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]
    ).map((t) => t.name);
    for (const t of [
      "membership_plans", "members", "attendance", "renewals", "payments",
      "admin_profiles", "admin_credentials", "app_settings", "schema_migrations",
    ]) {
      expect(tables).toContain(t);
    }
  });

  it("enables WAL, full synchronous writes and foreign keys", () => {
    expect(mgr.db.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(mgr.db.pragma("synchronous", { simple: true })).toBe(2); // FULL
    expect(mgr.db.pragma("foreign_keys", { simple: true })).toBe(1);
  });

  it("seeds the four starter plans exactly once, even across re-opens", async () => {
    const read = () =>
      mgr.db.prepare("SELECT name, duration_months, fee_paise FROM membership_plans ORDER BY id").all();
    expect(read()).toEqual([
      { name: "1 Month", duration_months: 1, fee_paise: 150000 },
      { name: "2 Months", duration_months: 2, fee_paise: 200000 },
      { name: "3 Months", duration_months: 3, fee_paise: 250000 },
      { name: "4 Months", duration_months: 4, fee_paise: 320000 },
    ]);
    mgr.close();
    await mgr.open();
    expect(read()).toHaveLength(4);
  });

  it("passes integrity + foreign-key checks", () => {
    expect(integrityCheck(mgr.db)).toEqual({ ok: true, message: "ok" });
  });

  it("turns a damaged file into a friendly AppError instead of crashing", async () => {
    const bad = path.join(dir, "garbage.sqlite");
    fs.writeFileSync(bad, Buffer.from("this is definitely not a sqlite database ".repeat(40)));
    const m = new DatabaseManager(bad, nullLogger);
    await expect(m.open()).rejects.toBeInstanceOf(AppError);
    expect(m.isOpen).toBe(false);
  });
});

describe("schema constraints (the rules Postgres enforced)", () => {
  it("rejects a second ACTIVE check-in for the same member, allows one after check-out", () => {
    const id = addMember();
    const ins = mgr.db.prepare("INSERT INTO attendance (id, member_id, checked_in_at) VALUES (?, ?, ?)");
    const first = randomUUID();
    ins.run(first, id, "2026-10-03T05:00:00.000Z");
    expect(() => ins.run(randomUUID(), id, "2026-10-03T06:00:00.000Z")).toThrow(/UNIQUE/i);

    mgr.db
      .prepare("UPDATE attendance SET checked_out_at = ?, duration_minutes = 60 WHERE id = ?")
      .run("2026-10-03T06:00:00.000Z", first);
    expect(() => ins.run(randomUUID(), id, "2026-10-03T07:00:00.000Z")).not.toThrow();
  });

  it("cascades member deletion to attendance, renewals and payments", () => {
    const id = addMember();
    const renewalId = randomUUID();
    mgr.db.prepare("INSERT INTO attendance (id, member_id, checked_in_at) VALUES (?, ?, ?)").run(randomUUID(), id, "2026-10-03T05:00:00.000Z");
    mgr.db.prepare("INSERT INTO renewals (id, member_id, start_date) VALUES (?, ?, ?)").run(renewalId, id, "2026-10-01");
    mgr.db.prepare("INSERT INTO payments (id, member_id, renewal_id, amount_paise, method) VALUES (?, ?, ?, 150000, 'upi')").run(randomUUID(), id, renewalId);

    mgr.db.prepare("DELETE FROM members WHERE id = ?").run(id);
    for (const t of ["attendance", "renewals", "payments"]) {
      expect((mgr.db.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as { c: number }).c).toBe(0);
    }
  });

  it("refuses rows that point at a member that does not exist", () => {
    expect(() =>
      mgr.db.prepare("INSERT INTO attendance (id, member_id, checked_in_at) VALUES (?, ?, ?)").run(randomUUID(), randomUUID(), "2026-10-03T05:00:00.000Z")
    ).toThrow(/FOREIGN KEY/i);
  });

  it("keeps the member's plan_name snapshot when a plan is deleted", () => {
    const planId = (mgr.db.prepare("SELECT id FROM membership_plans WHERE name='1 Month'").get() as { id: number }).id;
    const id = addMember({});
    mgr.db.prepare("UPDATE members SET plan_id = ?, plan_name = '1 Month' WHERE id = ?").run(planId, id);
    mgr.db.prepare("DELETE FROM membership_plans WHERE id = ?").run(planId);
    expect(mgr.db.prepare("SELECT plan_id, plan_name FROM members WHERE id = ?").get(id)).toEqual({ plan_id: null, plan_name: "1 Month" });
  });

  it.each([
    ["invalid status", { status: "banned" }],
    ["malformed start date", { start_date: "03/10/2026" }],
    ["blank name", { name: "   " }],
  ])("rejects a member with %s", (_label, over) => {
    expect(() => addMember(over)).toThrow(/CHECK/i);
  });

  it("rejects non-positive payments and unknown payment methods", () => {
    const id = addMember();
    const renewalId = randomUUID();
    mgr.db.prepare("INSERT INTO renewals (id, member_id, start_date) VALUES (?, ?, ?)").run(renewalId, id, "2026-10-01");
    const pay = mgr.db.prepare("INSERT INTO payments (id, member_id, renewal_id, amount_paise, method) VALUES (?, ?, ?, ?, ?)");
    expect(() => pay.run(randomUUID(), id, renewalId, 0, "cash")).toThrow(/CHECK/i);
    expect(() => pay.run(randomUUID(), id, renewalId, 5000, "bitcoin")).toThrow(/CHECK/i);
    expect(() => pay.run(randomUUID(), id, renewalId, 5000, "cash")).not.toThrow();
  });

  it("refreshes updated_at on edits that do not set it", () => {
    const id = addMember();
    mgr.db.prepare("UPDATE members SET updated_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(id);
    mgr.db.prepare("UPDATE members SET name = 'Renamed' WHERE id = ?").run(id);
    const row = mgr.db.prepare("SELECT updated_at FROM members WHERE id = ?").get(id) as { updated_at: string };
    expect(row.updated_at > "2020-01-01T00:00:00.000Z").toBe(true);
  });

  it("enforces unique admin emails case-insensitively", () => {
    const ins = mgr.db.prepare("INSERT INTO admin_profiles (id, email) VALUES (?, ?)");
    ins.run(randomUUID(), "Owner@BodyTemple.com");
    expect(() => ins.run(randomUUID(), "owner@bodytemple.com")).toThrow(/UNIQUE/i);
  });
});

describe("migration safety", () => {
  it("rolls a failing migration back completely and keeps the old version", async () => {
    const file = path.join(dir, "mig.sqlite");
    const broken = [
      ...MIGRATIONS,
      { version: 2, name: "broken", up: "CREATE TABLE half_done (x INTEGER); INSERT INTO table_that_does_not_exist VALUES (1);" },
    ];
    const m = new DatabaseManager(file, nullLogger, MIGRATIONS);
    await m.open();
    m.close();

    const m2 = new DatabaseManager(file, nullLogger, broken);
    await expect(m2.open()).rejects.toBeInstanceOf(AppError);

    const check = new DatabaseManager(file, nullLogger, MIGRATIONS);
    await check.open();
    expect(currentVersion(check.db)).toBe(1);
    expect(check.db.prepare("SELECT name FROM sqlite_master WHERE name='half_done'").get()).toBeUndefined();
    check.close();
  });

  it("runs the pre-migration hook only for databases that already hold data", async () => {
    const file = path.join(dir, "hook.sqlite");
    const calls: [number, number][] = [];
    const hook = (from: number, to: number) => void calls.push([from, to]);

    const fresh = new DatabaseManager(file, nullLogger, MIGRATIONS);
    await fresh.open(hook);
    fresh.close();
    expect(calls).toEqual([]); // brand-new database: nothing to protect

    const v2 = [...MIGRATIONS, { version: 2, name: "add col", up: "ALTER TABLE members ADD COLUMN nickname TEXT;" }];
    const upgraded = new DatabaseManager(file, nullLogger, v2);
    await upgraded.open(hook);
    expect(calls).toEqual([[1, 2]]);
    expect(currentVersion(upgraded.db)).toBe(2);
    upgraded.close();
  });

  it("refuses to open a database written by a newer app version", async () => {
    const file = path.join(dir, "future.sqlite");
    const m = new DatabaseManager(file, nullLogger);
    await m.open();
    m.db.pragma("user_version = 99");
    m.close();
    await expect(new DatabaseManager(file, nullLogger).open()).rejects.toThrow(/newer version/i);
  });
});
