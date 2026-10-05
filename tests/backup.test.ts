import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { makeFull, expectCode, D, type Full } from "./helpers";
import { DatabaseManager } from "../electron/database/manager";
import { MIGRATIONS } from "../electron/database/migrations";
import { nullLogger } from "../electron/services/logger";

let env: Full;
beforeEach(async () => (env = await makeFull(/* 2026-10-03 10:00 */)));
afterEach(() => env.cleanup());

const member = (name: string) => env.members.create({ name, start_date: "2026-10-03", plan_id: 1, amount_due: 1500, initial_payment: 500 });
const names = () => (env.mgr.db.prepare("SELECT name FROM members ORDER BY name").all() as { name: string }[]).map((r) => r.name);
const sidecars = (dir: string) => fs.readdirSync(dir).filter((f) => /-(wal|shm|journal)$|\.partial$/.test(f));

describe("creating backups", () => {
  it("writes a verified, self-contained file and leaves the live database usable", async () => {
    member("Asha");
    const b = await env.backup.create("manual");
    expect(b).toMatchObject({ kind: "manual", fileName: expect.stringMatching(/^bodytemple-manual-20261003-100000\.sqlite$/) });
    expect(b.sizeBytes).toBeGreaterThan(0);
    expect(env.backup.verify(b.fileName)).toMatchObject({ ok: true, memberCount: 1, schemaVersion: 1 });
    expect(sidecars(env.backup.dir)).toEqual([]);
    expect(() => member("Bhavin")).not.toThrow();
  });

  it("is safe while writes are happening (online backup, not a file copy)", async () => {
    for (let i = 0; i < 50; i++) member(`Member ${i}`);
    const pending = env.backup.create("manual");
    for (let i = 50; i < 80; i++) member(`Member ${i}`); // writes interleave with the running backup
    const b = await pending;
    const v = env.backup.verify(b.fileName);
    expect(v.ok).toBe(true);
    expect(v.memberCount).toBeGreaterThanOrEqual(50);
  });

  it("never overwrites: same-second backups get unique names, newest first", async () => {
    const a = await env.backup.create("manual");
    const b = await env.backup.create("manual");
    expect(a.fileName).not.toBe(b.fileName);
    expect(env.backup.list().map((e) => e.fileName)).toEqual([b.fileName, a.fileName]);
  });

  it("exports a verified copy to a chosen path", async () => {
    member("Asha");
    const dest = path.join(env.dir, "usb", "copy.sqlite");
    fs.mkdirSync(path.dirname(dest));
    fs.writeFileSync(dest, "old content");
    expect(await env.backup.exportTo(dest)).toEqual({ done: true, path: dest });
    expect(env.backup.verifyFile(dest)).toMatchObject({ ok: true, memberCount: 1 });
    expect(sidecars(path.dirname(dest))).toEqual([]);
  });

  it("copies manual/auto backups to the secondary folder when one is set", async () => {
    const second = path.join(env.dir, "onedrive");
    env.backup.saveSettings({ ...env.backup.getSettings(), secondaryDir: second });
    const b = await env.backup.create("manual");
    expect(fs.existsSync(path.join(second, b.fileName))).toBe(true);
  });
});

describe("automatic backups and retention", () => {
  it("runs when due, not before, and not when disabled", async () => {
    env.backup.saveSettings({ ...env.backup.getSettings(), autoEnabled: false });
    expect(await env.backup.maybeAutoBackup()).toBeNull();
    env.backup.saveSettings({ ...env.backup.getSettings(), autoEnabled: true, intervalHours: 24 });
    expect((await env.backup.maybeAutoBackup())?.kind).toBe("auto");
    env.advance(23 * 3_600_000);
    expect(await env.backup.maybeAutoBackup()).toBeNull();
    env.advance(2 * 3_600_000);
    expect(await env.backup.maybeAutoBackup()).not.toBeNull();
  });

  it("keeps only the newest N automatic backups and never deletes manual ones", async () => {
    env.backup.saveSettings({ ...env.backup.getSettings(), keepAuto: 2 });
    const manual = await env.backup.create("manual");
    for (let i = 0; i < 4; i++) {
      env.advance(3_600_000);
      await env.backup.create("auto");
    }
    const all = env.backup.list();
    expect(all.filter((e) => e.kind === "auto")).toHaveLength(2);
    expect(all.find((e) => e.fileName === manual.fileName)).toBeTruthy();
  });

  it("validates settings and rejects path tricks when removing", async () => {
    expect(() => env.backup.saveSettings({ ...env.backup.getSettings(), intervalHours: 0 })).toThrow();
    await expectCode(() => env.backup.remove("../../etc/passwd"), "VALIDATION");
    await expectCode(() => env.backup.remove("bodytemple-manual-20200101-000000.sqlite"), "NOT_FOUND");
  });

  it("records integrity checks", () => {
    expect(env.backup.checkIntegrity()).toEqual({ ok: true, message: "ok" });
    expect(env.backup.lastIntegrity()).toMatchObject({ ok: true });
  });
});

describe("restoring", () => {
  it("puts the data back, saves a pre-restore copy, ends the session and keeps working", async () => {
    member("Asha");
    const snap = await env.backup.create("manual");
    member("Bhavin");
    expect(names()).toEqual(["Asha", "Bhavin"]);

    const r = await env.backup.restoreFromList(snap.fileName);
    expect(r.done).toBe(true);
    expect(names()).toEqual(["Asha"]);
    expect(env.invalidated).toEqual(["restored"]);

    const pre = env.backup.list().find((e) => e.kind === "pre-restore")!;
    expect(env.backup.verify(pre.fileName)).toMatchObject({ ok: true, memberCount: 2 }); // Bhavin is recoverable
    expect(() => member("Chirag")).not.toThrow();
    expect(sidecars(path.dirname(env.mgr.dbPath)).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("refuses damaged, foreign and newer-version files and changes nothing", async () => {
    member("Asha");
    const junk = path.join(env.dir, "junk.sqlite");
    fs.writeFileSync(junk, "definitely not sqlite ".repeat(50));
    await expectCode(() => env.backup.restore(junk), "VALIDATION");

    const foreign = path.join(env.dir, "foreign.sqlite");
    const f = new Database(foreign);
    f.exec("CREATE TABLE notes (x TEXT)");
    f.close();
    await expectCode(() => env.backup.restore(foreign), "VALIDATION");

    const future = path.join(env.dir, "future.sqlite");
    await env.backup.exportTo(future);
    const fu = new Database(future);
    fu.pragma("user_version = 99");
    fu.close();
    const e = await expectCode(() => env.backup.restore(future), "VALIDATION");
    expect(e.message).toMatch(/newer version/i);

    await expectCode(() => env.backup.restore(path.join(env.dir, "missing.sqlite")), "VALIDATION");
    expect(names()).toEqual(["Asha"]);
    expect(env.invalidated).toEqual([]);
    expect(env.backup.list().filter((x) => x.kind === "pre-restore")).toHaveLength(0);
  });

  it("rolls back to the previous data if the reopen after the swap fails", async () => {
    member("Asha");
    const snap = await env.backup.create("manual");
    member("Bhavin");
    const realOpen = env.mgr.open.bind(env.mgr);
    let failed = false;
    env.mgr.open = async (...a: Parameters<typeof realOpen>) => {
      if (!failed) {
        failed = true;
        throw new Error("simulated failure while reopening");
      }
      return realOpen(...a);
    };
    await expectCode(() => env.backup.restoreFromList(snap.fileName), "DATABASE");
    expect(names()).toEqual(["Asha", "Bhavin"]); // previous data back, nothing lost
    expect(env.invalidated).toEqual([]);
  });

  it("migrates an older backup forward on restore, after saving a pre-migration copy", async () => {
    const v2 = [...MIGRATIONS, { version: 2, name: "add nickname", up: "ALTER TABLE members ADD COLUMN nickname TEXT;" }];
    const upgraded = await makeFull({ migrations: v2 });
    try {
      // an old (schema v1) backup file produced by the previous app version
      const oldFile = path.join(upgraded.dir, "old-v1.sqlite");
      const old = new DatabaseManager(oldFile, nullLogger, MIGRATIONS);
      await old.open();
      old.db.prepare("INSERT INTO members (id, name, start_date) VALUES ('m1', 'Legacy Member', '2026-01-01')").run();
      old.close();

      expect(upgraded.mgr.schemaVersion).toBe(2);
      await upgraded.backup.restore(oldFile);
      expect(upgraded.mgr.schemaVersion).toBe(2);
      const row = upgraded.mgr.db.prepare("SELECT name, nickname FROM members").get() as { name: string; nickname: string | null };
      expect(row).toEqual({ name: "Legacy Member", nickname: null });
      expect(upgraded.backup.list().some((e) => e.kind === "pre-migration")).toBe(true);
    } finally {
      upgraded.cleanup();
    }
  });

  it("removes half-written leftovers from a crashed backup", () => {
    fs.writeFileSync(path.join(env.backup.dir, "bodytemple-manual-20261003-100000.sqlite.ab12.partial"), "x");
    env.backup.cleanupPartials();
    expect(sidecars(env.backup.dir)).toEqual([]);
    void D;
  });
});
