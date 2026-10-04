"use client";

import { useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { cn } from "@/lib/utils";
import type { AttendanceTrendGranularity, AttendanceTrendPoint } from "@/lib/attendance";

const OPTIONS: { key: AttendanceTrendGranularity; label: string }[] = [
  { key: "daily", label: "Daily" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
];

export default function AttendanceTrendChart({
  data,
}: {
  data: Record<AttendanceTrendGranularity, AttendanceTrendPoint[]>;
}) {
  const [granularity, setGranularity] = useState<AttendanceTrendGranularity>("daily");
  const points = data[granularity];

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
              width={32}
              allowDecimals={false}
              tick={{ fill: "#f5f1e699", fontSize: 12, fontFamily: "Geist Sans, sans-serif" }}
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
              formatter={(value) => [`${value}`, "Check-ins"]}
            />
            <Bar dataKey="count" fill="#ffc22c" radius={[0, 0, 0, 0]} maxBarSize={36} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
