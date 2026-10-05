import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import Database from "better-sqlite3";
import { AppError } from "@shared/errors";
import type { ActionResult, BackupEntry, BackupKind, BackupSettings, BackupVerification } from "@shared/types";
import type { DatabaseManager } from "../database/manager";
import { integrityCheck } from "../database/migrate";
import type { Logger } from "./logger";
import type { SettingsService } from "./settings";
import { systemClock, type Clock } from "./util";

const NAME_RE = /^bodytemple-(manual|auto|pre-restore|pre-migration|pre-import|exported)-(\d{8})-(\d{6})(?:-(\d+))?\.sqlite$/;
const REQUIRED_TABLES = ["members", "membership_plans", "attendance", "renewals", "payments", "admin_profiles"];
const KEEP_SAFETY_COPIES = 10;

export const DEFAULT_BACKUP_SETTINGS: BackupSettings = { autoEnabled: true, intervalHours: 24, keepAuto: 14, secondaryDir: null };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Antivirus / indexers on Windows can briefly lock a file; retry before giving up. */
async function withRetry<T>(fn: () => T, tries = 6, delay = 150): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return fn();
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (i >= tries - 1 || !["EBUSY", "EPERM", "EACCES"].includes(String(code))) throw e;
      await sleep(delay * (i + 1));
    }
  }
}

function removeWithSidecars(file: string) {
  for (const ext of ["", "-wal", "-shm", "-journal"]) fs.rmSync(file + ext, { force: true });
}

/** Opens `file` read-only and reports whether it is a healthy Body Temple Gym database. */
function inspectDb(file: string, maxVersion: number): BackupVerification {
  let db: Database.Database | null = null;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
    const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name));
    const missing = REQUIRED_TABLES.filter((t) => !tables.has(t));
    if (missing.length) return { ok: false, schemaVersion: null, memberCount: null, message: "This file is a database, but not a Body Temple Gym one." };
    const version = Number(db.pragma("user_version", { simple: true }));
    if (version > maxVersion) {
      return { ok: false, schemaVersion: version, memberCount: null, message: "This backup was made by a newer version of Body Temple Gym. Update the app first." };
    }
    const check = integrityCheck(db);
    if (!check.ok) return { ok: false, schemaVersion: version, memberCount: null, message: `The file is damaged (${check.message}).` };
    const members = (db.prepare("SELECT COUNT(*) c FROM members").get() as { c: number }).c;
    return { ok: true, schemaVersion: version, memberCount: members, message: `Verified: ${members} member${members === 1 ? "" : "s"}, schema v${version}.` };
  } catch {
    return { ok: false, schemaVersion: null, memberCount: null, message: "That file isn't a valid SQLite database." };
  } finally {
    try {
      db?.close();
    } catch {
      /* ignore */
    }
  }
}

export class BackupService {
  private restoring: Promise<unknown> | null = null;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly mgr: DatabaseManager,
    readonly dir: string,
    private readonly settings: SettingsService,
    private readonly log: Logger,
    private readonly clock: Clock = systemClock,
    private readonly onRestored: () => void = () => {}
  ) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // ---- settings -----------------------------------------------------------
  getSettings(): BackupSettings {
    return { ...DEFAULT_BACKUP_SETTINGS, ...this.settings.get<Partial<BackupSettings>>("backup.settings", {}) };
  }

  saveSettings(s: BackupSettings): BackupSettings {
    if (!Number.isInteger(s.intervalHours) || s.intervalHours < 1 || s.intervalHours > 720) throw new AppError("VALIDATION", "Back up every 1 to 720 hours.");
    if (!Number.isInteger(s.keepAuto) || s.keepAuto < 1 || s.keepAuto > 365) throw new AppError("VALIDATION", "Keep between 1 and 365 automatic backups.");
    const next: BackupSettings = { autoEnabled: !!s.autoEnabled, intervalHours: s.intervalHours, keepAuto: s.keepAuto, secondaryDir: s.secondaryDir?.trim() || null };
    this.settings.set("backup.settings", next);
    return next;
  }

  /** Resolves when every queued backup/restore operation has finished (used on shutdown). */
  async drain(): Promise<void> {
    await this.chain.catch(() => undefined);
  }

  /** Resolves once any restore in progress has finished (IPC handlers wait on this). */
  async whenIdle(): Promise<void> {
    if (this.restoring) await this.restoring.catch(() => undefined);
  }

  // ---- listing ------------------------------------------------------------
  private parse(file: string): (BackupEntry & { seq: number }) | null {
    const m = NAME_RE.exec(file);
    if (!m) return null;
    const full = path.join(this.dir, file);
    let size = 0;
    try {
      size = fs.statSync(full).size;
    } catch {
      return null;
    }
    const [, kind, ymd, hms, seq] = m;
    const createdAt = new Date(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8), +hms.slice(0, 2), +hms.slice(2, 4), +hms.slice(4, 6)).toISOString();
    return { fileName: file, path: full, sizeBytes: size, createdAt, kind: kind as BackupKind, seq: seq ? Number(seq) : 0 };
  }

  list(): BackupEntry[] {
    let files: string[] = [];
    try {
      files = fs.readdirSync(this.dir);
    } catch {
      return [];
    }
    return files
      .map((f) => this.parse(f))
      .filter((e): e is BackupEntry & { seq: number } => e !== null)
      .sort((a, b) => (a.createdAt === b.createdAt ? b.seq - a.seq : a.createdAt < b.createdAt ? 1 : -1))
      .map(({ seq: _seq, ...e }) => {
        void _seq;
        return e;
      });
  }

  /** Remove half-written files left by a crash mid-backup. */
  cleanupPartials(): void {
    try {
      for (const f of fs.readdirSync(this.dir)) if (f.endsWith(".partial")) fs.rmSync(path.join(this.dir, f), { force: true });
    } catch {
      /* ignore */
    }
  }

  private pathFor(fileName: string): string {
    if (!NAME_RE.test(fileName)) throw new AppError("VALIDATION", "That isn't one of the app's backup files.");
    const full = path.join(this.dir, fileName);
    if (!fs.existsSync(full)) throw new AppError("NOT_FOUND", "That backup file no longer exists.");
    return full;
  }

  // ---- create -------------------------------------------------------------
  private stamp() {
    const d = this.clock();
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }

  private uniqueName(kind: BackupKind) {
    const base = `bodytemple-${kind}-${this.stamp()}`;
    let name = `${base}.sqlite`;
    for (let i = 1; fs.existsSync(path.join(this.dir, name)); i++) name = `${base}-${i}.sqlite`;
    return name;
  }

  /** Snapshot via SQLite's online backup API: safe while the app keeps writing. Writes to `dest` atomically. */
  private async snapshotTo(dest: string): Promise<void> {
    const tmp = `${dest}.${randomBytes(3).toString("hex")}.partial`;
    try {
      await this.mgr.db.backup(tmp);
      const copy = new Database(tmp); // make it one self-contained file (no -wal/-shm companions)
      try {
        copy.pragma("journal_mode = DELETE");
      } finally {
        copy.close();
      }
      const v = inspectDb(tmp, this.mgr.latestVersion);
      if (!v.ok) throw new AppError("DATABASE", `The backup could not be verified and was discarded (${v.message})`);
      await withRetry(() => fs.renameSync(tmp, dest));
    } catch (e) {
      removeWithSidecars(tmp);
      throw e;
    }
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async createInternal(kind: BackupKind): Promise<BackupEntry> {
    fs.mkdirSync(this.dir, { recursive: true });
    const name = this.uniqueName(kind);
    const full = path.join(this.dir, name);
    await this.snapshotTo(full);
    this.log.info(`Backup created: ${name}`);
    if (kind === "manual" || kind === "auto") this.copyToSecondary(full);
    this.prune();
    return this.parse(name) as BackupEntry;
  }

  create(kind: BackupKind = "manual"): Promise<BackupEntry> {
    return this.exclusive(() => this.createInternal(kind));
  }

  /** "Export backup…": a verified copy written to a location the user chose. */
  exportTo(dest: string): Promise<ActionResult> {
    return this.exclusive(async () => {
      await this.snapshotTo(dest);
      this.log.info("Backup exported to a user-chosen location");
      return { done: true, path: dest };
    });
  }

  private copyToSecondary(file: string) {
    const dir = this.getSettings().secondaryDir;
    if (!dir) return;
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(file, path.join(dir, path.basename(file)));
    } catch (e) {
      this.log.warn("Could not copy backup to the secondary folder", e);
    }
  }

  prune(): void {
    const { keepAuto } = this.getSettings();
    const all = this.list();
    const drop = (entries: BackupEntry[], keep: number) =>
      entries.slice(keep).forEach((e) => removeWithSidecars(e.path));
    drop(all.filter((e) => e.kind === "auto"), keepAuto);
    for (const k of ["pre-restore", "pre-migration", "pre-import"] as BackupKind[]) drop(all.filter((e) => e.kind === k), KEEP_SAFETY_COPIES);
  }

  /** Runs when the app starts and hourly after: takes an automatic backup if one is due. */
  maybeAutoBackup(): Promise<BackupEntry | null> {
    const s = this.getSettings();
    if (!s.autoEnabled) return Promise.resolve(null);
    const last = this.list().find((e) => e.kind === "auto");
    const due = !last || this.clock().getTime() - Date.parse(last.createdAt) >= s.intervalHours * 3_600_000;
    return due ? this.create("auto") : Promise.resolve(null);
  }

  // ---- verify -------------------------------------------------------------
  /** Verifies any file (works on read-only media): checked on a temporary copy. */
  verifyFile(file: string): BackupVerification {
    if (!fs.existsSync(file)) return { ok: false, schemaVersion: null, memberCount: null, message: "File not found." };
    const tmp = path.join(os.tmpdir(), `btg-verify-${randomBytes(4).toString("hex")}.sqlite`);
    try {
      fs.copyFileSync(file, tmp);
      return inspectDb(tmp, this.mgr.latestVersion);
    } catch {
      return { ok: false, schemaVersion: null, memberCount: null, message: "The file couldn't be read." };
    } finally {
      removeWithSidecars(tmp);
    }
  }

  verify(fileName: string): BackupVerification {
    return this.verifyFile(this.pathFor(fileName));
  }

  remove(fileName: string): void {
    removeWithSidecars(this.pathFor(fileName));
  }

  checkIntegrity(): { ok: boolean; message: string } {
    const r = integrityCheck(this.mgr.db);
    this.settings.set("integrity.last", { at: this.clock().toISOString(), ok: r.ok, message: r.message });
    if (!r.ok) this.log.error("Integrity check failed", r);
    return r;
  }

  lastIntegrity(): { at: string; ok: boolean; message: string } | null {
    return this.settings.get<{ at: string; ok: boolean; message: string } | null>("integrity.last", null);
  }

  // ---- restore ------------------------------------------------------------
  restoreFromList(fileName: string): Promise<ActionResult> {
    return this.restore(this.pathFor(fileName));
  }

  /**
   * Replaces the live database with `src`. Steps: verify the file → snapshot the current data
   * ("pre-restore") → close → atomic swap → reopen (migrating if the backup is older). If anything
   * fails after the swap, the pre-restore snapshot is put back. The caller must already have confirmed.
   */
  restore(src: string): Promise<ActionResult> {
    const run = this.exclusive(async () => {
      const v = this.verifyFile(src);
      if (!v.ok) throw new AppError("VALIDATION", `That file can't be restored: ${v.message}`);

      const safety = await this.createInternal("pre-restore");
      const dbPath = this.mgr.dbPath;
      const staged = path.join(path.dirname(dbPath), `restore-${randomBytes(4).toString("hex")}.tmp`);
      try {
        fs.copyFileSync(src, staged);
        this.mgr.close();
        this.mgr.removeSidecars();
        await withRetry(() => fs.renameSync(staged, dbPath));
        await this.mgr.open(() => this.snapshotBeforeMigration());
      } catch (e) {
        this.log.error("Restore failed; putting the previous database back", e);
        try {
          this.mgr.close();
          this.mgr.removeSidecars();
          await withRetry(() => fs.copyFileSync(safety.path, dbPath));
          await this.mgr.open();
        } catch (e2) {
          this.log.error("Rollback after failed restore also failed", e2);
        }
        throw new AppError("DATABASE", "The restore failed, so your previous data was put back unchanged.");
      } finally {
        fs.rmSync(staged, { force: true });
      }
      this.log.info("Database restored from backup", { schemaVersion: v.schemaVersion, members: v.memberCount });
      this.onRestored();
      return { done: true, message: `Restored ${v.memberCount} member${v.memberCount === 1 ? "" : "s"}. Your previous data was saved as a "pre-restore" backup.` } as ActionResult;
    });
    this.restoring = run;
    return run.finally(() => {
      if (this.restoring === run) this.restoring = null;
    });
  }

  /** Used while the DB is mid-open (migrating): a plain file copy is safe because no writes are in flight. */
  snapshotBeforeMigration(kind: BackupKind = "pre-migration") {
    const name = this.uniqueName(kind);
    const full = path.join(this.dir, name);
    this.mgr.checkpoint();
    fs.copyFileSync(this.mgr.dbPath, full);
    this.log.info(`Backup created before migration: ${name}`);
  }
}
