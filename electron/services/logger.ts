import fs from "node:fs";
import path from "node:path";

export interface Logger {
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
}

export const nullLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

const SENSITIVE_KEY = /pass(word)?|secret|token|private[_-]?key|service[_-]?key|recovery|authorization|credential|hash/i;

/** Deeply copies `value`, replacing anything that looks like a secret. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth]";
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? "[REDACTED]" : redact(v, depth + 1);
    }
    return out;
  }
  if (typeof value === "string" && value.length > 2000) return value.slice(0, 2000) + "…";
  return value;
}

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;

export interface FileLogger extends Logger {
  readonly dir: string;
}

/** Append-only daily log files, e.g. app-2026-10-03.log, pruned after `keepDays`. */
export function createFileLogger(
  dir: string,
  opts: { level?: keyof typeof LEVELS; keepDays?: number; echo?: boolean } = {}
): FileLogger {
  const min = LEVELS[opts.level ?? "info"];
  const keepDays = opts.keepDays ?? 30;
  try {
    fs.mkdirSync(dir, { recursive: true });
    const cutoff = Date.now() - keepDays * 86_400_000;
    for (const f of fs.readdirSync(dir)) {
      if (!/^app-\d{4}-\d{2}-\d{2}\.log$/.test(f)) continue;
      const p = path.join(dir, f);
      if (fs.statSync(p).mtimeMs < cutoff) fs.rmSync(p, { force: true });
    }
  } catch {
    /* logging must never crash the app */
  }

  function write(level: keyof typeof LEVELS, message: string, meta?: unknown) {
    if (LEVELS[level] < min) return;
    const now = new Date();
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    let line = `${now.toISOString()} ${level.toUpperCase().padEnd(5)} ${message}`;
    if (meta !== undefined) {
      try {
        line += " " + JSON.stringify(redact(meta));
      } catch {
        line += " [unserialisable meta]";
      }
    }
    try {
      fs.appendFileSync(path.join(dir, `app-${day}.log`), line + "\n", "utf8");
    } catch {
      /* ignore */
    }
    if (opts.echo) (level === "error" ? console.error : console.log)(line);
  }

  return {
    dir,
    debug: (m, meta) => write("debug", m, meta),
    info: (m, meta) => write("info", m, meta),
    warn: (m, meta) => write("warn", m, meta),
    error: (m, meta) => write("error", m, meta),
  };
}
