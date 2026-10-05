import { z } from "zod";
import { AppError, type ApiErrorShape } from "@shared/errors";
import type { Logger } from "../services/logger";

const SQLITE_MESSAGES: Record<string, ApiErrorShape> = {
  SQLITE_CONSTRAINT_UNIQUE: { code: "CONFLICT", message: "That already exists." },
  SQLITE_CONSTRAINT_PRIMARYKEY: { code: "CONFLICT", message: "That already exists." },
  SQLITE_CONSTRAINT_FOREIGNKEY: { code: "CONFLICT", message: "That refers to something that no longer exists. Refresh and try again." },
  SQLITE_CONSTRAINT_CHECK: { code: "VALIDATION", message: "One of the values isn't allowed. Please check the form." },
  SQLITE_CONSTRAINT_NOTNULL: { code: "VALIDATION", message: "A required value is missing." },
  SQLITE_BUSY: { code: "DATABASE", message: "The database is busy right now. Please try again in a moment." },
  SQLITE_LOCKED: { code: "DATABASE", message: "The database is busy right now. Please try again in a moment." },
  SQLITE_FULL: { code: "DATABASE", message: "The disk is full, so nothing could be saved. Free up some space and try again." },
  SQLITE_READONLY: { code: "DATABASE", message: "The database file is read-only. Check the folder's permissions." },
  SQLITE_CORRUPT: { code: "DATABASE", message: "The database looks damaged. Restore a backup from Settings → Data safety." },
  SQLITE_NOTADB: { code: "DATABASE", message: "The database looks damaged. Restore a backup from Settings → Data safety." },
};
const GENERIC_DB: ApiErrorShape = { code: "DATABASE", message: "A database error occurred. The details were saved to the log file." };
const NOISY = new Set(["DATABASE", "IO", "UNKNOWN"]);

function zodMessage(e: z.ZodError): string {
  const issue = e.issues[0];
  if (!issue) return "Please check the form.";
  const generic = /^(Invalid|Too (small|big)|Expected|Unrecognized|Required)/i.test(issue.message);
  const field = issue.path.map(String).join(".");
  return generic && field ? `The value for "${field}" isn't valid.` : issue.message;
}

/**
 * Turns anything thrown by a handler into a message that is safe and useful to show the user.
 * Technical detail goes to the log file only (the logger redacts secrets).
 */
export function toApiError(e: unknown, log: Logger, where: string): ApiErrorShape {
  if (e instanceof AppError) {
    if (NOISY.has(e.code)) log.error(`${where}: ${e.message}`);
    return { code: e.code, message: e.message };
  }
  if (e instanceof z.ZodError) return { code: "VALIDATION", message: zodMessage(e) };
  const sqliteCode = typeof (e as { code?: unknown })?.code === "string" ? (e as { code: string }).code : "";
  if (sqliteCode.startsWith("SQLITE_")) {
    log.error(`${where}: database error ${sqliteCode}`, e);
    return SQLITE_MESSAGES[sqliteCode] ?? GENERIC_DB;
  }
  log.error(`${where}: unexpected error`, e);
  return { code: "UNKNOWN", message: "Something went wrong. The details were saved to the log file." };
}
