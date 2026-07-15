"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { phpCompact } from "@/lib/format";

export function CashflowChart({
  data,
}: {
  data: { month: string; inflow: number; outflow: number }[];
}) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#edebe9" />
          <XAxis dataKey="month" tick={{ fontSize: 12 }} />
          <YAxis tickFormatter={(v: number) => phpCompact(v)} tick={{ fontSize: 11 }} width={70} />
          <Tooltip
            formatter={(v: number | string, name: string) => [
              phpCompact(Number(v)),
              name === "inflow" ? "Payments received" : "Committed cost",
            ]}
          />
          <Legend
            formatter={(v: string) => (v === "inflow" ? "Payments received" : "Committed cost")}
          />
          <Line
            type="monotone"
            dataKey="inflow"
            stroke="#10b981"
            strokeWidth={2.5}
            dot={{ r: 3.5, fill: "#10b981" }}
            activeDot={{ r: 5 }}
          />
          <Line
            type="monotone"
            dataKey="outflow"
            stroke="#6e1420"
            strokeWidth={2.5}
            dot={{ r: 3.5, fill: "#6e1420" }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
