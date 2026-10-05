import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type Clock = () => Date;
export const systemClock: Clock = () => new Date();
export const newId = () => randomUUID();

const p2 = (n: number) => String(n).padStart(2, "0");
export const toLocalDateStr = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;

export function isDateStr(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
}

function ymd(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return { y, m, d };
}
const fmtUtc = (dt: Date) => `${dt.getUTCFullYear()}-${p2(dt.getUTCMonth() + 1)}-${p2(dt.getUTCDate())}`;

export function addDaysStr(s: string, n: number): string {
  const { y, m, d } = ymd(s);
  return fmtUtc(new Date(Date.UTC(y, m - 1, d + n)));
}

/** Same clamping rules as date-fns addMonths (31 Jan + 1 month = 28/29 Feb). */
export function addMonthsStr(s: string, n: number): string {
  const { y, m, d } = ymd(s);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12;
  const dim = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${p2(nm + 1)}-${p2(Math.min(d, dim))}`;
}

/** Whole calendar days from `from` to `to` (DST-safe). */
export function diffDays(from: string, to: string): number {
  const a = ymd(from);
  const b = ymd(to);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000);
}

export function localMidnight(dateStr: string): Date {
  const { y, m, d } = ymd(dateStr);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

/** [start, end) of a local calendar day as ISO instants. */
export function dayBoundsIso(dateStr: string) {
  return {
    startIso: localMidnight(dateStr).toISOString(),
    endIso: localMidnight(addDaysStr(dateStr, 1)).toISOString(),
  };
}

export const minutesBetween = (fromIso: string, toIso: string) =>
  Math.max(0, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60_000));

/** Write via a temp file + rename so a crash can never leave a half-written file. */
export function writeFileAtomic(file: string, data: string | Buffer) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
