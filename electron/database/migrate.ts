import { AppError } from "@shared/errors";
import type { Logger } from "../services/logger";
import type { Db } from "./connection";
import type { Migration } from "./migrations";

export function currentVersion(db: Db): number {
  return Number(db.pragma("user_version", { simple: true }));
}

export interface MigrateOptions {
  log?: Logger;
  /** Called (and awaited) before the first pending migration touches an existing database. */
  beforeMigrate?: (from: number, to: number) => Promise<void> | void;
}

/**
 * Applies pending migrations, each inside its own transaction. If a
 * migration throws, that transaction rolls back and the database is left at
 * the previous version — it is never left half-migrated.
 */
export async function migrate(db: Db, migrations: Migration[], opts: MigrateOptions = {}): Promise<number> {
  const latest = migrations[migrations.length - 1]?.version ?? 0;
  const from = currentVersion(db);

  if (from > latest) {
    throw new AppError(
      "DATABASE",
      `This database was created by a newer version of Body Temple Gym (schema ${from}, this app supports up to ${latest}). Please update the application.`
    );
  }

  const pending = migrations.filter((m) => m.version > from).sort((a, b) => a.version - b.version);
  if (pending.length === 0) return from;

  if (from > 0) await opts.beforeMigrate?.(from, latest);

  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`);

  for (const m of pending) {
    opts.log?.info(`Applying migration ${m.version}: ${m.name}`);
    const run = db.transaction(() => {
      if (typeof m.up === "string") db.exec(m.up);
      else m.up(db);
      db.prepare("INSERT INTO schema_migrations (version, name) VALUES (?, ?)").run(m.version, m.name);
      db.pragma(`user_version = ${m.version}`);
    });
    try {
      run.exclusive();
    } catch (err) {
      opts.log?.error(`Migration ${m.version} failed and was rolled back`, err);
      throw new AppError(
        "DATABASE",
        `Database upgrade ${m.version} (${m.name}) failed and was rolled back. Your data is unchanged.`
      );
    }
  }
  return latest;
}

export function quickCheck(db: Db): { ok: boolean; message: string } {
  const rows = db.pragma("quick_check") as { quick_check: string }[];
  const ok = rows.length === 1 && rows[0].quick_check === "ok";
  return { ok, message: ok ? "ok" : rows.map((r) => r.quick_check).slice(0, 5).join("; ") };
}

export function integrityCheck(db: Db): { ok: boolean; message: string } {
  const rows = db.pragma("integrity_check") as { integrity_check: string }[];
  if (!(rows.length === 1 && rows[0].integrity_check === "ok")) {
    return { ok: false, message: rows.map((r) => r.integrity_check).slice(0, 5).join("; ") };
  }
  const fk = db.pragma("foreign_key_check") as unknown[];
  if (fk.length > 0) return { ok: false, message: `${fk.length} foreign key violation(s) found` };
  return { ok: true, message: "ok" };
}
