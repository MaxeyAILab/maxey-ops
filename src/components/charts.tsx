"use client";

import {
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
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

interface AccomplishmentItem {
  workItem: string;
  weight: number;
  pctComplete: number;
  color: string;
}

/**
 * Weighted-average accomplishment gauge (Spec 6.7) — a single ring, split
 * into one colored segment per work item (sized by its contribution —
 * weight × completion% — to the total), plus a grey segment for whatever's
 * still outstanding. The colored segments sum to the number in the center.
 */
export function AccomplishmentRadial({ items }: { items: AccomplishmentItem[] }) {
  const segments = items.map((it) => ({
    name: it.workItem,
    value: Math.max(0, Math.min(100, (it.weight * it.pctComplete) / 100)),
    fill: it.color,
  }));
  const total = segments.reduce((s, d) => s + d.value, 0);
  const remaining = Math.max(0, 100 - total);
  const data = remaining > 0 ? [...segments, { name: "Remaining", value: remaining, fill: "#edebe9" }] : segments;

  return (
    <div className="relative h-44 w-44">
      <ResponsiveContainer>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius="72%"
            outerRadius="100%"
            startAngle={90}
            endAngle={-270}
            stroke="none"
            isAnimationActive={false}
          >
            {data.map((d, i) => (
              <Cell key={i} fill={d.fill} />
            ))}
          </Pie>
          {segments.length > 0 && (
            <Tooltip
              formatter={(v: number | string, name: string) =>
                name === "Remaining" ? ["Remaining", ""] : [`${Number(v).toFixed(1)}%`, name]
              }
            />
          )}
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-black tabular-nums text-ink-900">{total.toFixed(0)}%</span>
        <span className="text-[10px] font-medium uppercase tracking-wide text-ink-400">
          Weighted
        </span>
      </div>
    </div>
  );
}

/** Per-work-item horizontal weight bars, colored to match their ring on the radial gauge. */
export function WorkItemWeightBars({ items }: { items: AccomplishmentItem[] }) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-ink-400">
        No weighted work items yet — set a weight and color on a progress entry to start
        tracking.
      </p>
    );
  }
  return (
    <div className="space-y-2.5">
      {items.map((it) => (
        <div key={it.workItem}>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 font-medium text-ink-700">
              <span
                className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                style={{ backgroundColor: it.color }}
                aria-hidden
              />
              {it.workItem}
            </span>
            <span className="tabular-nums text-ink-400">
              {it.weight.toFixed(0)}% weight · {it.pctComplete.toFixed(0)}% done
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-ink-100">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.max(0, Math.min(100, it.pctComplete))}%`,
                backgroundColor: it.color,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
