import type { DatabaseManager } from "../database/manager";

/** Tiny JSON key/value store on top of the app_settings table. */
export class SettingsService {
  constructor(private readonly mgr: DatabaseManager) {}

  get<T>(key: string, fallback: T): T {
    const row = this.mgr.db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as { value: string } | undefined;
    if (!row) return fallback;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return fallback;
    }
  }

  set(key: string, value: unknown): void {
    this.mgr.db
      .prepare(
        `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(key, JSON.stringify(value));
  }

  delete(key: string): void {
    this.mgr.db.prepare("DELETE FROM app_settings WHERE key = ?").run(key);
  }
}
