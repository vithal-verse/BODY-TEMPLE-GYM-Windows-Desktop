import type { Db } from "../connection";
import { SQL_001_INITIAL } from "./001_initial";

export interface Migration {
  version: number;
  name: string;
  /** SQL string, or a function for data migrations. Runs inside one transaction. */
  up: string | ((db: Db) => void);
}

/**
 * Append-only. Never edit a released migration — add a new one with the
 * next version number. The runner applies pending ones in order on startup.
 */
export const MIGRATIONS: Migration[] = [
  { version: 1, name: "initial schema", up: SQL_001_INITIAL },
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;
