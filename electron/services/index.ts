import type { DatabaseManager } from "../database/manager";
import { AttendanceService } from "./attendance";
import { AuthService, DEFAULT_SCRYPT, type ScryptCost } from "./auth";
import { BackupService } from "./backup";
import { ImportService } from "./importer";
import type { Logger } from "./logger";
import { MembersService } from "./members";
import { PlansService } from "./plans";
import type { Platform } from "./platform";
import { DashboardService, ExportService, RevenueService } from "./reports";
import { SettingsService } from "./settings";
import { SheetsService } from "./sheets";
import { systemClock, type Clock } from "./util";

export interface ServiceDeps {
  mgr: DatabaseManager;
  log: Logger;
  platform: Platform;
  backupDir: string;
  clock?: Clock;
  scrypt?: ScryptCost;
  /** Called after a restore replaces the database (the session must end). */
  onSessionInvalidated?: (reason: string) => void;
  fetchFn?: ConstructorParameters<typeof SheetsService>[6];
}

export function createServices(d: ServiceDeps) {
  const clock = d.clock ?? systemClock;
  const settings = new SettingsService(d.mgr);
  const auth = new AuthService(d.mgr, d.log, clock, d.scrypt ?? DEFAULT_SCRYPT);
  const plans = new PlansService(d.mgr);
  const notifier = { notify: () => {} };
  const members = new MembersService(d.mgr, clock, () => notifier.notify());
  const attendance = new AttendanceService(d.mgr, clock);
  const dashboard = new DashboardService(d.mgr, members, clock);
  const revenue = new RevenueService(d.mgr, members, clock);
  const exports = new ExportService(d.mgr, revenue, clock);
  const backup = new BackupService(d.mgr, d.backupDir, settings, d.log, clock, () => {
    auth.invalidate();
    d.onSessionInvalidated?.("restored");
  });
  const sheets = new SheetsService(d.mgr, members, settings, d.platform, d.log, clock, d.fetchFn);
  notifier.notify = () => sheets.notifyChanged();
  const importer = new ImportService(d.mgr, members, backup, d.log, clock);
  return { mgr: d.mgr, log: d.log, platform: d.platform, clock, settings, auth, plans, members, attendance, dashboard, revenue, exports, backup, sheets, importer };
}

export type Services = ReturnType<typeof createServices>;
