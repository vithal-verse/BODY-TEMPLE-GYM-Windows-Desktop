import type { PaymentWithMember } from "@/lib/payments";

export type RevenueTrendGranularity = "daily" | "weekly" | "monthly";

export interface RevenueTrendPoint {
  label: string;
  amount: number;
}

/**
 * Buckets already-fetched payments into a trend series. Deliberately in
 * its own file with zero Supabase imports: it's called from a client
 * component (RevenueTrendChart), and this file must never import
 * anything that touches `@/lib/supabase/server` — that file pulls in
 * `next/headers`, which Next.js correctly refuses to bundle for the
 * client. Importing *anything* non-type from a module pulls in that
 * module's entire dependency graph, not just the one export being used —
 * which is why this can't just live inside payments.ts alongside the
 * server-only query functions.
 */
export function getRevenueTrend(
  payments: PaymentWithMember[],
  granularity: RevenueTrendGranularity
): RevenueTrendPoint[] {
  const now = new Date();

  if (granularity === "daily") {
    const buckets: RevenueTrendPoint[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      buckets.push({
        label: d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
        amount: 0,
      });
    }
    payments.forEach(({ payment }) => {
      const d = new Date(payment.paid_at);
      const daysAgo = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
      const idx = 13 - daysAgo;
      if (idx >= 0 && idx < buckets.length) buckets[idx].amount += payment.amount;
    });
    return buckets;
  }

  if (granularity === "weekly") {
    const buckets: RevenueTrendPoint[] = [];
    const weekStarts: Date[] = [];
    for (let i = 7; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i * 7 - now.getDay());
      d.setHours(0, 0, 0, 0);
      weekStarts.push(d);
      buckets.push({
        label: d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
        amount: 0,
      });
    }
    payments.forEach(({ payment }) => {
      const d = new Date(payment.paid_at);
      for (let i = weekStarts.length - 1; i >= 0; i--) {
        if (d >= weekStarts[i]) {
          buckets[i].amount += payment.amount;
          break;
        }
      }
    });
    return buckets;
  }

  // monthly
  const buckets: RevenueTrendPoint[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({ label: d.toLocaleDateString("en-IN", { month: "short" }), amount: 0 });
  }
  payments.forEach(({ payment }) => {
    const d = new Date(payment.paid_at);
    const monthsAgo =
      (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
    if (monthsAgo >= 0 && monthsAgo <= 5) {
      buckets[5 - monthsAgo].amount += payment.amount;
    }
  });
  return buckets;
}
