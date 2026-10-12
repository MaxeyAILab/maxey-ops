"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Fig, FigPlain, FigText, FigureToggle, useFiguresHidden } from "@/components/figure-visibility";
import { php, phpCompact } from "@/lib/format";

// ---------- shared bits ----------

export function SeverityChip({ severity }: { severity: 0 | 1 | 2 }) {
  const map = {
    2: { text: "Critical", icon: "▲", cls: "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300" },
    1: { text: "Watch", icon: "●", cls: "bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300" },
    0: { text: "On plan", icon: "✓", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300" },
  }[severity];
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-sm px-2 py-0.5 text-xs font-semibold ${map.cls}`}>
      <span aria-hidden="true" className="text-[10px]">
        {map.icon}
      </span>
      {map.text}
    </span>
  );
}

/** Exact peso value as a native tooltip — but only while figures are visible. */
function useExactTitle() {
  const hidden = useFiguresHidden();
  return (n: number | null | undefined) => (hidden || n == null ? undefined : php(n));
}

// ---------- header controls ----------

const PERIODS = [
  ["30d", "Last 30 days"],
  ["90d", "Last 90 days"],
  ["ytd", "Year to date"],
  ["12m", "Last 12 months"],
] as const;

export function DashboardControls({
  period,
  scope,
  clientId,
  clients,
  updatedAt,
}: {
  period: string;
  scope: string;
  clientId: string | null;
  clients: { id: string; name: string }[];
  updatedAt: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function setParam(key: string, value: string, fallback: string) {
    const next = new URLSearchParams(params.toString());
    if (!value || value === fallback) next.delete(key);
    else next.set(key, value);
    const qs = next.toString();
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname));
  }

  const time = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" }).format(
    new Date(updatedAt)
  );
  const select =
    "rounded-sm border border-ink-200 bg-ink-50 px-2.5 py-1.5 text-sm text-ink-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500";

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <h1 className="text-2xl font-bold text-ink-900">Owner overview</h1>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="sr-only" htmlFor="od-period">
          Date range
        </label>
        <select id="od-period" className={select} value={period} onChange={(e) => setParam("period", e.target.value, "90d")}>
          {PERIODS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="od-scope">
          Projects shown
        </label>
        <select id="od-scope" className={select} value={scope} onChange={(e) => setParam("scope", e.target.value, "active")}>
          <option value="active">Active projects</option>
          <option value="all">All projects</option>
        </select>
        <label className="sr-only" htmlFor="od-client">
          Client
        </label>
        <select id="od-client" className={select} value={clientId ?? ""} onChange={(e) => setParam("client", e.target.value, "")}>
          <option value="">All clients</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => startTransition(() => router.refresh())}
          className="rounded-sm border border-ink-200 bg-ink-50 px-2.5 py-1.5 text-sm font-medium text-ink-700 hover:bg-ink-100"
        >
          {pending ? "Refreshing…" : "↻ Refresh"}
        </button>
        <span className="whitespace-nowrap text-xs text-ink-500">Updated {time}</span>
        <FigureToggle />
      </div>
    </div>
  );
}

// ---------- active project portfolio (sortable) ----------

export interface PortfolioRow {
  id: string;
  name: string;
  clientName: string;
  statusLabel: string;
  manager: string | null;
  isCompleted: boolean;
  isProspective: boolean;
  contract: number;
  committed: number;
  pct: number;
  lastProgressAt: string | null;
  costState: "ok" | "early" | "final" | "no-cost" | "no-progress";
  forecastCost: number | null;
  forecastProfit: number | null;
  forecastMarginPct: number | null;
  targetMarginPct: number | null;
  scheduleState: "on-plan" | "watch" | "late" | "overdue" | "done" | "no-target" | "unknown";
  scheduleVarianceDays: number | null;
  plannedPct: number | null;
  forecastFinish: string | null;
  severity: 0 | 1 | 2;
  deterioration: number;
  topIssue: string | null;
  nextAction: string | null;
}

type SortKey = "risk" | "name" | "pct" | "schedule" | "contract" | "committed" | "forecastCost" | "margin";

const shortDate = (iso: string) =>
  new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric" }).format(new Date(iso));

function ScheduleCell({ r }: { r: PortfolioRow }) {
  const v = r.scheduleVarianceDays;
  switch (r.scheduleState) {
    case "done":
      return <span className="text-ink-500">Turned over</span>;
    case "no-target":
      return <span className="text-ink-500">No target date</span>;
    case "unknown":
      return <span className="text-ink-500">Too early to forecast</span>;
    case "overdue":
      return (
        <span className="font-medium text-red-700 dark:text-red-300">
          ▲ Past target
          <span className="block text-xs font-normal">+{v} days</span>
        </span>
      );
    case "late":
    case "watch":
      return (
        <span className={r.scheduleState === "late" ? "font-medium text-red-700 dark:text-red-300" : "font-medium text-amber-800 dark:text-amber-300"}>
          {r.scheduleState === "late" ? "▲" : "●"} Behind plan
          <span className="block text-xs font-normal">
            {r.pct.toFixed(0)}% done · {r.plannedPct?.toFixed(0)}% of time
          </span>
          {r.forecastFinish && <span className="block text-xs font-normal">Finish ~{shortDate(r.forecastFinish)}</span>}
        </span>
      );
    default:
      return (
        <span className="text-emerald-800 dark:text-emerald-300">
          ✓ On plan
          {r.plannedPct != null && (
            <span className="block text-xs text-ink-500">
              {r.pct.toFixed(0)}% done · {r.plannedPct.toFixed(0)}% of time
            </span>
          )}
          {r.forecastFinish && <span className="block text-xs text-ink-500">Finish ~{shortDate(r.forecastFinish)}</span>}
        </span>
      );
  }
}

function costNote(state: PortfolioRow["costState"]) {
  if (state === "no-cost") return "Awaiting cost update";
  if (state === "no-progress") return "Awaiting progress";
  return null;
}

export function PortfolioTable({ rows }: { rows: PortfolioRow[] }) {
  const router = useRouter();
  const exact = useExactTitle();
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "risk", dir: 1 });

  const sorted = useMemo(() => {
    const val = (r: PortfolioRow): number | string | null => {
      switch (sort.key) {
        case "name":
          return r.name.toLowerCase();
        case "pct":
          return r.pct;
        case "schedule":
          return r.scheduleVarianceDays;
        case "contract":
          return r.contract;
        case "committed":
          return r.committed;
        case "forecastCost":
          return r.forecastCost;
        case "margin":
          return r.forecastMarginPct;
        default:
          return null;
      }
    };
    const copy = [...rows];
    if (sort.key === "risk") {
      copy.sort((a, b) => (b.severity - a.severity || b.deterioration - a.deterioration || b.contract - a.contract) * sort.dir);
      return copy;
    }
    copy.sort((a, b) => {
      const x = val(a);
      const y = val(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1; // unknowns always last
      if (y == null) return -1;
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
    return copy;
  }, [rows, sort]);

  function head(key: SortKey, label: string, align: "left" | "right" = "left") {
    const active = sort.key === key;
    return (
      <th
        scope="col"
        aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
        className={`border-b border-ink-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-ink-500 ${align === "right" ? "text-right" : ""}`}
      >
        <button
          type="button"
          onClick={() => setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: key === "risk" || key === "name" || key === "margin" ? 1 : -1 }))}
          className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-ink-900 ${active ? "text-ink-900" : ""}`}
        >
          {label}
          <span aria-hidden="true" className="text-[9px]">
            {active ? (sort.dir === 1 ? "▲" : "▼") : "↕"}
          </span>
        </button>
      </th>
    );
  }

  if (rows.length === 0)
    return <p className="px-5 py-10 text-center text-sm text-ink-500">No projects match the current filters.</p>;

  // Forecast totals only include projects whose forecast is reliable (enough cost + progress), same rule as the KPI card.
  const reliable = rows.filter((r) => r.forecastCost != null && (r.costState === "ok" || r.costState === "final"));
  const totals = {
    contract: rows.reduce((sum, r) => sum + r.contract, 0),
    committed: rows.reduce((sum, r) => sum + r.committed, 0),
    forecastCost: reliable.reduce((sum, r) => sum + r.forecastCost!, 0),
    forecastProfit: reliable.reduce((sum, r) => sum + r.forecastProfit!, 0),
    coveredContract: reliable.reduce((sum, r) => sum + r.contract, 0),
    covered: reliable.length,
    eligible: rows.filter((r) => !r.isProspective).length,
  };

  return (
    <div className="overflow-x-auto">
    <table className="w-full min-w-[1000px] table-fixed text-left text-[13px]">
      <colgroup>
        <col className="w-[22%]" />
        <col className="w-[10%]" />
        <col className="w-[12%]" />
        <col className="w-[9%]" />
        <col className="w-[9%]" />
        <col className="w-[10%]" />
        <col className="w-[11%]" />
        <col className="w-[17%]" />
      </colgroup>
      <thead>
        <tr>
          {head("name", "Project")}
          {head("pct", "Progress")}
          {head("schedule", "Schedule")}
          {head("contract", "Contract", "right")}
          {head("committed", "Cost to date", "right")}
          {head("forecastCost", "Forecast cost", "right")}
          {head("margin", "Forecast margin", "right")}
          {head("risk", "Health")}
        </tr>
      </thead>
      <tbody>
        {sorted.map((r) => (
          <tr
            key={r.id}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest("a")) return;
              router.push(`/projects/${r.id}`);
            }}
            className="cursor-pointer border-b border-ink-100 hover:bg-ink-100/60"
          >
            <td className="px-3 py-2.5 align-top">
              <Link href={`/projects/${r.id}`} className="font-medium text-brand-600 hover:underline">
                {r.name}
              </Link>
              <div className="truncate text-xs text-ink-500">
                {r.clientName} · {r.statusLabel}
              </div>
              <div className="truncate text-xs text-ink-400">PM: {r.manager ?? "Unassigned"}</div>
            </td>
            <td className="px-3 py-2.5 align-top" title={r.lastProgressAt ? `Weighted work-item progress · last update ${shortDate(r.lastProgressAt)}` : "No progress reported"}>
              <div className="tabular-nums">{r.pct.toFixed(0)}%</div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-ink-200">
                <div className="h-full bg-brand-500" style={{ width: `${Math.min(100, Math.max(0, r.pct))}%` }} />
              </div>
            </td>
            <td className="px-3 py-2.5 align-top">
              <ScheduleCell r={r} />
            </td>
            <td className="px-3 py-2.5 text-right align-top tabular-nums" title={exact(r.contract)}>
              <Fig>{phpCompact(r.contract)}</Fig>
            </td>
            <td className="px-3 py-2.5 text-right align-top tabular-nums" title={exact(r.committed)}>
              {r.committed > 0 || r.costState === "final" ? (
                <Fig>{phpCompact(r.committed)}</Fig>
              ) : (
                <span className="text-xs text-ink-500">Not reported</span>
              )}
            </td>
            <td className="px-3 py-2.5 text-right align-top tabular-nums" title={exact(r.forecastCost)}>
              {r.forecastCost != null ? (
                <>
                  {r.costState === "early" && <span className="text-ink-500">~</span>}
                  <Fig>{phpCompact(r.forecastCost)}</Fig>
                  {r.costState === "early" && <span className="block text-[11px] text-ink-500">early estimate</span>}
                </>
              ) : (
                <span className="text-xs text-ink-500">{costNote(r.costState) ?? "—"}</span>
              )}
            </td>
            <td className="px-3 py-2.5 text-right align-top tabular-nums" title={exact(r.forecastProfit)}>
              {r.forecastMarginPct != null ? (
                <>
                  <span className={r.forecastMarginPct < 0 ? "font-semibold text-red-700 dark:text-red-300" : ""}>
                    {r.costState === "early" && "~"}
                    <FigPlain>{r.forecastMarginPct.toFixed(1)}%</FigPlain>
                  </span>
                  {r.forecastProfit != null && (
                    <span className="block text-[11px] text-ink-500">
                      <Fig>{phpCompact(r.forecastProfit)}</Fig>
                      {r.targetMarginPct != null && <> · target {r.targetMarginPct.toFixed(0)}%</>}
                    </span>
                  )}
                </>
              ) : (
                <span className="text-xs text-ink-500">Pending cost data</span>
              )}
            </td>
            <td className="px-3 py-2.5 align-top">
              {r.isProspective && r.severity === 0 ? (
                <span className="inline-flex items-center rounded-sm bg-ink-200 px-2 py-0.5 text-xs font-semibold text-ink-700">Prospective</span>
              ) : (
                <SeverityChip severity={r.severity} />
              )}
              {r.topIssue && (
                <div className="mt-1 text-xs text-ink-700">
                  <FigText>{r.topIssue}</FigText>
                </div>
              )}
              {r.nextAction && <div className="text-xs text-ink-500">Next: {r.nextAction}</div>}
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t-2 border-ink-300 bg-ink-100/70 font-semibold text-ink-900">
          <td className="px-3 py-2.5 align-top">
            Total · {rows.length} project{rows.length === 1 ? "" : "s"}
          </td>
          <td className="px-3 py-2.5" />
          <td className="px-3 py-2.5" />
          <td className="px-3 py-2.5 text-right tabular-nums" title={exact(totals.contract)}>
            <Fig>{phpCompact(totals.contract)}</Fig>
          </td>
          <td className="px-3 py-2.5 text-right tabular-nums" title={exact(totals.committed)}>
            <Fig>{phpCompact(totals.committed)}</Fig>
          </td>
          <td className="px-3 py-2.5 text-right tabular-nums" title={exact(totals.forecastCost)}>
            {totals.covered > 0 ? <Fig>{phpCompact(totals.forecastCost)}</Fig> : <span className="text-xs font-normal text-ink-500">—</span>}
          </td>
          <td className="px-3 py-2.5 text-right tabular-nums" title={exact(totals.forecastProfit)}>
            {totals.covered > 0 && totals.coveredContract > 0 ? (
              <>
                <FigPlain>{((totals.forecastProfit / totals.coveredContract) * 100).toFixed(1)}%</FigPlain>
                <span className="block text-[11px] font-normal text-ink-500">
                  <Fig>{phpCompact(totals.forecastProfit)}</Fig>
                </span>
              </>
            ) : (
              <span className="text-xs font-normal text-ink-500">Pending cost data</span>
            )}
          </td>
          <td className="px-3 py-2.5 align-top text-xs font-normal text-ink-500">
            Forecast covers {totals.covered} of {totals.eligible} project{totals.eligible === 1 ? "" : "s"}
          </td>
        </tr>
      </tfoot>
    </table>
    </div>
  );
}

// ---------- period inflow / outflow bars ----------

export function FlowChart({ data }: { data: { label: string; inflow: number; outflow: number }[] }) {
  const hidden = useFiguresHidden();
  if (hidden)
    return (
      <div className="flex h-56 items-center justify-center rounded-sm border border-dashed border-ink-200 text-sm text-ink-500">
        Chart hidden — click “Show figures” to reveal.
      </div>
    );
  const empty = data.every((d) => d.inflow === 0 && d.outflow === 0);
  if (empty)
    return (
      <div className="flex h-56 items-center justify-center text-sm text-ink-500">
        No payments or committed costs recorded in this period.
      </div>
    );
  return (
    <div className="h-56 w-full" role="img" aria-label="Collected versus committed cost per period">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgb(var(--ink-200))" />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "rgb(var(--ink-500))" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
          <YAxis
            tickFormatter={(v: number) => phpCompact(v)}
            tick={{ fontSize: 11, fill: "rgb(var(--ink-500))" }}
            width={62}
            tickLine={false}
            axisLine={false}
            domain={[0, "auto"]}
          />
          <ReferenceLine y={0} stroke="rgb(var(--ink-400))" />
          <Tooltip
            cursor={{ fill: "rgb(var(--ink-200) / 0.4)" }}
            contentStyle={{ background: "rgb(var(--ink-50))", border: "1px solid rgb(var(--ink-200))", fontSize: 12 }}
            labelStyle={{ color: "rgb(var(--ink-900))" }}
            formatter={(v: number | string, name: string) => [php(Number(v)), name === "inflow" ? "Collected" : "Committed cost"]}
          />
          <Bar dataKey="inflow" fill="#0b8a70" radius={[2, 2, 0, 0]} maxBarSize={22} />
          <Bar dataKey="outflow" fill="#c0503f" radius={[2, 2, 0, 0]} maxBarSize={22} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------- horizontal bar list (receivables / retention / procurement) ----------

export function BarList({
  items,
  tone = "brand",
}: {
  items: { label: string; sub?: string; value: number; display?: string }[];
  tone?: "brand" | "amber" | "oxide";
}) {
  const exact = useExactTitle();
  const max = Math.max(...items.map((i) => i.value), 1);
  const color = { brand: "bg-brand-500", amber: "bg-amber-500", oxide: "bg-[#c0503f]" }[tone];
  return (
    <ul className="space-y-2.5">
      {items.map((i) => (
        <li key={i.label + (i.sub ?? "")}>
          <div className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="truncate text-ink-800">
              {i.label}
              {i.sub && <span className="text-ink-500"> · {i.sub}</span>}
            </span>
            <span className="shrink-0 tabular-nums text-ink-900" title={exact(i.value)}>
              {i.display ? <FigPlain>{i.display}</FigPlain> : <Fig>{phpCompact(i.value)}</Fig>}
            </span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-ink-200">
            <div className={`h-full ${color}`} style={{ width: `${Math.max((i.value / max) * 100, i.value > 0 ? 2 : 0)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---------- tiny trend line (cash balance checks) ----------

export function Sparkline({ values }: { values: number[] }) {
  const hidden = useFiguresHidden();
  if (hidden || values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const w = 72;
  const h = 22;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - min) / span) * (h - 4)).toFixed(1)}`);
  const last = pts[pts.length - 1].split(",");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Trend of recorded bank balances" className="text-brand-500">
      <polyline points={pts.join(" ")} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="2.2" fill="currentColor" />
    </svg>
  );
}
