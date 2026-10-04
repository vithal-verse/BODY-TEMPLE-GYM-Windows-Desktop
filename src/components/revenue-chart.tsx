"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

export default function RevenueChart({
  data,
}: {
  data: { month: string; revenue: number }[];
}) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid
            strokeDasharray="0"
            vertical={false}
            stroke="#2c271d"
          />
          <XAxis
            dataKey="month"
            axisLine={{ stroke: "#2c271d" }}
            tickLine={false}
            tick={{ fill: "#f5f1e699", fontSize: 12, fontFamily: "Geist Sans, sans-serif" }}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            width={40}
            tick={{ fill: "#f5f1e699", fontSize: 12, fontFamily: "Geist Sans, sans-serif" }}
            tickFormatter={(v) =>
              v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`
            }
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
            formatter={(value) => [
              new Intl.NumberFormat("en-IN", {
                style: "currency",
                currency: "INR",
                maximumFractionDigits: 0,
              }).format(Number(value) || 0),
              "Revenue",
            ]}
          />
          <Bar dataKey="revenue" fill="#ffc22c" radius={[0, 0, 0, 0]} maxBarSize={48} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
