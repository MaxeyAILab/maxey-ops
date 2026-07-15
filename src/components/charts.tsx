"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
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
        <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#edebe9" />
          <XAxis dataKey="month" tick={{ fontSize: 12 }} />
          <YAxis tickFormatter={(v: number) => phpCompact(v)} tick={{ fontSize: 11 }} width={70} />
          <Tooltip
            formatter={(v: number | string, name: string) => [
              phpCompact(Number(v)),
              name === "inflow" ? "Payments received" : "Committed cost (POs)",
            ]}
          />
          <Legend
            formatter={(v: string) =>
              v === "inflow" ? "Payments received" : "Committed cost (POs)"
            }
          />
          <Bar dataKey="inflow" fill="#10b981" radius={[3, 3, 0, 0]} />
          <Bar dataKey="outflow" fill="#6e1420" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
