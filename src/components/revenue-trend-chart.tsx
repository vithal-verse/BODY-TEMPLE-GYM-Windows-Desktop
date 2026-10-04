"use client";

import { useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { cn, formatCurrency } from "@/lib/utils";
import { getRevenueTrend, type RevenueTrendGranularity } from "@/lib/revenue-trend";
import type { PaymentWithMember } from "@/lib/payments";

const OPTIONS: { key: RevenueTrendGranularity; label: string }[] = [
  { key: "daily", label: "Daily" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
];

export default function RevenueTrendChart({
  allPayments,
}: {
  allPayments: PaymentWithMember[];
}) {
  const [granularity, setGranularity] = useState<RevenueTrendGranularity>("daily");
  // Always computed from the full, unfiltered payment set — a trend chart
  // scoped down to "Today" would just be one bar, so this is deliberately
  // independent of the page's date-range filter, same as the equivalent
  // chart on the Attendance page.
  const points = useMemo(() => getRevenueTrend(allPayments, granularity), [allPayments, granularity]);

  return (
    <div>
      <div className="mb-4 flex gap-2">
        {OPTIONS.map((o) => (
          <button
            key={o.key}
            onClick={() => setGranularity(o.key)}
            className={cn(
              "border-2 px-3 py-1.5 font-body text-xs font-semibold uppercase tracking-wide transition-colors",
              granularity === o.key
                ? "border-mango bg-mango text-ink"
                : "border-ink-line text-paper/50 hover:border-paper/30"
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="0" vertical={false} stroke="#2c271d" />
            <XAxis
              dataKey="label"
              axisLine={{ stroke: "#2c271d" }}
              tickLine={false}
              tick={{ fill: "#f5f1e699", fontSize: 11, fontFamily: "Geist Sans, sans-serif" }}
              interval={granularity === "daily" ? 1 : 0}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              width={44}
              tick={{ fill: "#f5f1e699", fontSize: 12, fontFamily: "Geist Sans, sans-serif" }}
              tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`)}
            />
            <Tooltip
              cursor={{ fill: "#ffc22c14" }}
              contentStyle={{
                background: "#17140f",
                border: "2px solid #2c271d",
                borderRadius: 0,
                fontFamily: "Geist Sans, sans-serif",
                fontSize: 13,
              }}
              labelStyle={{ color: "#f5f1e6" }}
              itemStyle={{ color: "#ffc22c" }}
              formatter={(value) => [formatCurrency(Number(value) || 0), "Revenue"]}
            />
            <Bar dataKey="amount" fill="#ffc22c" radius={[0, 0, 0, 0]} maxBarSize={36} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
