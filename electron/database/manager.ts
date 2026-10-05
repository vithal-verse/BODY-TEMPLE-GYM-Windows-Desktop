import fs from "node:fs";
import path from "node:path";
import { AppError } from "@shared/errors";
import type { Logger } from "../services/logger";
import { openConnection, type Db } from "./connection";
import { migrate, currentVersion, quickCheck } from "./migrate";
import { MIGRATIONS, type Migration } from "./migrations";

/**
 * Owns the single live SQLite connection. Services read `manager.db` on every
 * call instead of caching the handle, so a restore can swap the underlying
 * file and reopen transparently.
 */
export class DatabaseManager {
  private conn: Db | null = null;

  constructor(
    readonly dbPath: string,
    private readonly log: Logger,
    private readonly migrations: Migration[] = MIGRATIONS
  ) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  get db(): Db {
    if (!this.conn) throw new AppError("DATABASE", "The database is not open.");
    return this.conn;
  }

  /** Newest schema version this build understands (backups newer than this are refused). */
  get latestVersion(): number {
    return this.migrations[this.migrations.length - 1]?.version ?? 0;
  }

  get isOpen(): boolean {
    return this.conn !== null;
  }

  get schemaVersion(): number {
    return this.conn ? currentVersion(this.conn) : 0;
  }

  get sizeBytes(): number {
    try {
      return fs.statSync(this.dbPath).size;
    } catch {
      return 0;
    }
  }

  /** Opens (creating if needed), checks and migrates the database. */
  async open(beforeMigrate?: (from: number, to: number) => Promise<void> | void): Promise<void> {
    if (this.conn) return;
    let conn: Db;
    try {
      conn = openConnection(this.dbPath);
    } catch (err) {
      this.log.error("Could not open database file", err);
      throw new AppError(
        "DATABASE",
        "The database file could not be opened. It may be damaged or locked by another program. Restore a backup from Settings → Data safety, or contact support."
      );
    }
    try {
      const qc = quickCheck(conn);
      if (!qc.ok) {
        throw new AppError("DATABASE", `The database file failed its integrity check (${qc.message}).`);
      }
      this.conn = conn;
      await migrate(conn, this.migrations, { log: this.log, beforeMigrate });
    } catch (err) {
      this.conn = null;
      try {
        conn.close();
      } catch {
        /* ignore */
      }
      throw err;
    }
    this.log.info(`Database ready (schema v${currentVersion(this.conn!)}) at ${this.dbPath}`);
  }

  /** Flush the WAL into the main file so the .sqlite file alone is complete. */
  checkpoint(): void {
    if (!this.conn) return;
    try {
      this.conn.pragma("wal_checkpoint(TRUNCATE)");
    } catch (err) {
      this.log.warn("WAL checkpoint failed", err);
    }
  }

  close(): void {
    if (!this.conn) return;
    this.checkpoint();
    try {
      this.conn.close();
    } finally {
      this.conn = null;
    }
  }

  /** Removes WAL/SHM sidecar files (only call while closed). */
  removeSidecars(): void {
    for (const ext of ["-wal", "-shm", "-journal"]) {
      fs.rmSync(this.dbPath + ext, { force: true });
    }
  }
}
