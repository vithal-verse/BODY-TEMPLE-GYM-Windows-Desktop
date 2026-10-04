import Database from "better-sqlite3";

export type Db = Database.Database;

/**
 * Opens a SQLite connection with the pragmas this app relies on:
 *  - WAL journal: readers never block the writer; crash-safe.
 *  - synchronous=FULL: a committed transaction survives power loss.
 *  - foreign_keys=ON: relationships are enforced by the database.
 *  - busy_timeout: tolerate a second process briefly holding the lock.
 */
export function openConnection(
  filePath: string,
  opts: { readonly?: boolean; fileMustExist?: boolean } = {}
): Db {
  const db = new Database(filePath, {
    readonly: opts.readonly ?? false,
    fileMustExist: opts.fileMustExist ?? false,
    timeout: 8000,
  });
  if (!opts.readonly) {
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = FULL");
  }
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 8000");
  db.pragma("trusted_schema = OFF");

  // Unicode-aware lower(): SQLite's built-in lower()/NOCASE only fold ASCII, so
  // search and name-sorting (ORDER BY ulower(name)) use this instead.
  db.function("ulower", { deterministic: true }, (s: unknown) =>
    s === null || s === undefined ? null : String(s).toLowerCase()
  );
  return db;
}

/** Escape LIKE wildcards so user input is matched literally. */
export function likeContains(input: string): string {
  return `%${input.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export function runInTransaction<T>(db: Db, fn: () => T): T {
  // IMMEDIATE takes the write lock up front, so the read-then-write sequences
  // inside services (check duplicate, then insert) cannot interleave.
  return db.transaction(fn).immediate();
}
