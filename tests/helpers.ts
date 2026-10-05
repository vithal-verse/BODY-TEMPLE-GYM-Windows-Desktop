import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseManager } from "../electron/database/manager";
import { nullLogger } from "../electron/services/logger";
import { AuthService } from "../electron/services/auth";
import { PlansService } from "../electron/services/plans";
import { MembersService } from "../electron/services/members";
import { AttendanceService } from "../electron/services/attendance";
import { DashboardService, ExportService, RevenueService } from "../electron/services/reports";
import { AppError } from "@shared/errors";

export const FAST_SCRYPT = { N: 1024, r: 8, p: 1 };

export async function makeEnv(start = new Date(2026, 9, 3, 10, 0, 0)) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "btg-svc-"));
  const mgr = new DatabaseManager(path.join(dir, "data", "gym.sqlite"), nullLogger);
  await mgr.open();
  const time = { now: new Date(start) };
  const clock = () => new Date(time.now);
  const changes = { count: 0 };
  const auth = new AuthService(mgr, nullLogger, clock, FAST_SCRYPT);
  const plans = new PlansService(mgr);
  const members = new MembersService(mgr, clock, () => void changes.count++);
  const attendance = new AttendanceService(mgr, clock);
  const dashboard = new DashboardService(mgr, members, clock);
  const revenue = new RevenueService(mgr, members, clock);
  const exports = new ExportService(mgr, revenue, clock);
  return {
    dir, mgr, time, clock, changes, auth, plans, members, attendance, dashboard, revenue, exports,
    set(d: Date) { time.now = new Date(d); },
    advance(ms: number) { time.now = new Date(time.now.getTime() + ms); },
    cleanup() { mgr.close(); fs.rmSync(dir, { recursive: true, force: true }); },
  };
}
export type Env = Awaited<ReturnType<typeof makeEnv>>;

/** Asserts a promise/function rejects with an AppError of the given code. */
export async function expectCode(fn: () => unknown, code: string) {
  try {
    await fn();
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    if (e.code !== code) throw new Error(`Expected ${code} but got ${e.code}: ${e.message}`);
    return e;
  }
  throw new Error(`Expected AppError ${code} but nothing was thrown`);
}

export const D = (y: number, m: number, d: number, h = 10, min = 0) => new Date(y, m - 1, d, h, min, 0);

// ---------------------------------------------------------------------------
// Full service stack (backup, sheets, importer) with a fake host platform
// ---------------------------------------------------------------------------
import { createServices } from "../electron/services";
import type { Platform } from "../electron/services/platform";

export class FakePlatform implements Platform {
  nextSave: string | null = null;
  nextOpen: string | null = null;
  nextFolder: string | null = null;
  confirmAnswer = true;
  confirms: string[] = [];
  async saveFile() { return this.nextSave; }
  async openFile() { return this.nextOpen; }
  async openFolder() { return this.nextFolder; }
  async confirm(o: { title: string }) { this.confirms.push(o.title); return this.confirmAnswer; }
  async openPath() {}
  secretsAvailable() { return true; }
  encryptSecret(p: string) { return "enc:" + Buffer.from(p).toString("base64"); }
  decryptSecret(c: string) { return Buffer.from(c.slice(4), "base64").toString(); }
}

export async function makeFull(opts: { start?: Date; fetchFn?: unknown; migrations?: import("../electron/database/migrations").Migration[] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "btg-full-"));
  const mgr = new DatabaseManager(path.join(dir, "data", "gym.sqlite"), nullLogger, opts.migrations);
  await mgr.open();
  const time = { now: new Date(opts.start ?? new Date(2026, 9, 3, 10, 0, 0)) };
  const clock = () => new Date(time.now);
  const platform = new FakePlatform();
  const invalidated: string[] = [];
  const svc = createServices({
    mgr, log: nullLogger, platform, backupDir: path.join(dir, "backups"), clock, scrypt: FAST_SCRYPT,
    onSessionInvalidated: (r) => void invalidated.push(r), fetchFn: opts.fetchFn as never,
  });
  return {
    dir, time, invalidated, ...svc, platform,
    set(d: Date) { time.now = new Date(d); },
    advance(ms: number) { time.now = new Date(time.now.getTime() + ms); },
    cleanup() { svc.sheets.dispose(); try { mgr.close(); } catch { /* already closed */ } fs.rmSync(dir, { recursive: true, force: true }); },
  };
}
export type Full = Awaited<ReturnType<typeof makeFull>>;
