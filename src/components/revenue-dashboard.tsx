"use client";

import { useMemo, useState } from "react";
import { IndianRupee, Receipt, Calculator, AlertCircle } from "lucide-react";
import type { PaymentWithMember, OutstandingSummary } from "@/lib/payments";
import { resolveDateRange, DATE_RANGE_LABELS, type DateRangePreset } from "@/lib/date-ranges";
import { formatCurrency, cn } from "@/lib/utils";
import StatCard from "@/components/stat-card";
import RevenueTrendChart from "@/components/revenue-trend-chart";
import RevenueMethodBreakdown from "@/components/revenue-method-breakdown";
import RevenueTransactionsTable from "@/components/revenue-transactions-table";

const PRESETS: DateRangePreset[] = ["today", "this-week", "this-month", "last-3-months", "custom"];

export default function RevenueDashboard({
  allPayments,
  outstanding,
}: {
  allPayments: PaymentWithMember[];
  outstanding: OutstandingSummary;
}) {
  const [preset, setPreset] = useState<DateRangePreset>("this-month");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  const range = useMemo(
    () => resolveDateRange(preset, { start: customStart, end: customEnd }),
    [preset, customStart, customEnd]
  );

  const filteredPayments = useMemo(
    () =>
      allPayments.filter(({ payment }) => {
        const paidAt = new Date(payment.paid_at);
        return paidAt >= range.start && paidAt < range.end;
      }),
    [allPayments, range]
  );

  const totalRevenue = filteredPayments.reduce((sum, p) => sum + p.payment.amount, 0);
  const paymentCount = filteredPayments.length;
  const averagePayment = paymentCount > 0 ? totalRevenue / paymentCount : 0;

  return (
    <div className="flex flex-col gap-6">
      {/* Date range filter — drives stats, breakdown, and the table below.
          The trend chart is intentionally independent of this (see its
          own comment) since a chart scoped to "Today" would be one bar. */}
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((p) => (
          <button
            key={p}
            onClick={() => setPreset(p)}
            className={cn(
              "border-2 px-3 py-2 font-body text-xs font-semibold uppercase tracking-wide transition-colors",
              preset === p
                ? "border-mango bg-mango text-ink"
                : "border-ink-line text-paper/50 hover:border-paper/30"
            )}
          >
            {DATE_RANGE_LABELS[p]}
          </button>
        ))}
        {preset === "custom" && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="border-2 border-ink-line bg-ink-raised px-3 py-2 font-body text-sm text-paper outline-none focus:border-mango"
            />
            <span className="text-paper/40">to</span>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="border-2 border-ink-line bg-ink-raised px-3 py-2 font-body text-sm text-paper outline-none focus:border-mango"
            />
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total revenue"
          value={totalRevenue}
          format={formatCurrency}
          icon={IndianRupee}
          accent
          sublabel={DATE_RANGE_LABELS[preset]}
        />
        <StatCard
          label="Payments"
          value={paymentCount}
          icon={Receipt}
          sublabel={DATE_RANGE_LABELS[preset]}
        />
        <StatCard
          label="Average payment"
          value={averagePayment}
          format={formatCurrency}
          icon={Calculator}
          sublabel={DATE_RANGE_LABELS[preset]}
        />
        <StatCard
          label="Pending dues"
          value={outstanding.totalOutstanding}
          format={formatCurrency}
          icon={AlertCircle}
          sublabel="Across all members, right now"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="border-2 border-ink-line bg-ink-raised p-6 lg:col-span-2">
          <h2 className="mb-1 font-display text-xl text-paper">Revenue trend</h2>
          <p className="mb-4 font-body text-sm text-paper/40">
            Always shows recent history, independent of the filter above.
          </p>
          <RevenueTrendChart allPayments={allPayments} />
        </div>
        <div className="border-2 border-ink-line bg-ink-raised p-6">
          <h2 className="mb-1 font-display text-xl text-paper">By payment method</h2>
          <p className="mb-4 font-body text-sm text-paper/40">{DATE_RANGE_LABELS[preset]}</p>
          {filteredPayments.length === 0 ? (
            <p className="font-body text-sm text-paper/40">No payments in this range.</p>
          ) : (
            <RevenueMethodBreakdown payments={filteredPayments} />
          )}
        </div>
      </div>

      <div className="border-2 border-ink-line bg-ink-raised p-6">
        <h2 className="mb-1 font-display text-xl text-paper">Transactions</h2>
        <p className="mb-4 font-body text-sm text-paper/40">{DATE_RANGE_LABELS[preset]}</p>
        <RevenueTransactionsTable payments={filteredPayments} />
      </div>
    </div>
  );
}
