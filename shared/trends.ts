import type {
  AttendanceTrendPoint,
  RevenueTrendPoint,
  TrendGranularity,
} from "./types";

type Item = { at: string; value: number };
type Bucket = { label: string; value: number };

/**
 * Buckets timestamped values into the daily (14 days) / weekly (8 weeks) /
 * monthly (6 months) series used by the Attendance and Revenue trend
 * charts. Ported verbatim from the web app's getAttendanceTrend() and
 * getRevenueTrend() so bar placement matches the original exactly.
 */
export function bucketTrend(items: Item[], granularity: TrendGranularity, now = new Date()): Bucket[] {
  if (granularity === "daily") {
    const buckets: Bucket[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      buckets.push({
        label: d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
        value: 0,
      });
    }
    items.forEach((it) => {
      const d = new Date(it.at);
      const daysAgo = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
      const idx = 13 - daysAgo;
      if (idx >= 0 && idx < buckets.length) buckets[idx].value += it.value;
    });
    return buckets;
  }

  if (granularity === "weekly") {
    const buckets: Bucket[] = [];
    const weekStarts: Date[] = [];
    for (let i = 7; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i * 7 - now.getDay());
      d.setHours(0, 0, 0, 0);
      weekStarts.push(d);
      buckets.push({
        label: d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
        value: 0,
      });
    }
    items.forEach((it) => {
      const d = new Date(it.at);
      for (let i = weekStarts.length - 1; i >= 0; i--) {
        if (d >= weekStarts[i]) {
          buckets[i].value += it.value;
          break;
        }
      }
    });
    return buckets;
  }

  const buckets: Bucket[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({ label: d.toLocaleDateString("en-IN", { month: "short" }), value: 0 });
  }
  items.forEach((it) => {
    const d = new Date(it.at);
    const monthsAgo = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
    if (monthsAgo >= 0 && monthsAgo <= 5) buckets[5 - monthsAgo].value += it.value;
  });
  return buckets;
}

export function attendanceTrend(
  checkIns: string[],
  granularity: TrendGranularity,
  now = new Date()
): AttendanceTrendPoint[] {
  return bucketTrend(
    checkIns.map((at) => ({ at, value: 1 })),
    granularity,
    now
  ).map((b) => ({ label: b.label, count: b.value }));
}

export function revenueTrend(
  payments: { paid_at: string; amount: number }[],
  granularity: TrendGranularity,
  now = new Date()
): RevenueTrendPoint[] {
  return bucketTrend(
    payments.map((p) => ({ at: p.paid_at, value: p.amount })),
    granularity,
    now
  ).map((b) => ({ label: b.label, amount: b.value }));
}

/** Earliest instant any of the three trend windows can reach back to. */
export function trendWindowStart(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth() - 5, 1, 0, 0, 0, 0);
}
