import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { phpCompact } from "@/lib/format";
import { getOwnerDashboard, parseFilters, type AttentionItem, type OwnerDashboardData } from "@/lib/owner-dashboard";
import { Fig, FigPlain, FigText, FigureVisibilityProvider } from "@/components/figure-visibility";
import {
  BarList,
  DashboardControls,
  FlowChart,
  PortfolioTable,
  SeverityChip,
  Sparkline,
  type PortfolioRow,
} from "@/components/owner-dashboard-client";

export const metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

const DAY = 86_400_000;

function ago(d: Date | null, now: Date): string {
  if (!d) return "never recorded";
  const days = Math.floor((now.getTime() - d.getTime()) / DAY);
  if (days <= 0) return "today";
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

function Panel({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-sm border border-ink-200 bg-ink-50 ${className}`}>
      <header className="flex items-start justify-between gap-3 border-b border-ink-100 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-ink-900">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-ink-500">{subtitle}</p>}
        </div>
        {action}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Kpi({
  label,
  href,
  value,
  chip,
  lines,
  extra,
}: {
  label: string;
  href: string;
  value: React.ReactNode;
  chip?: React.ReactNode;
  lines: React.ReactNode[];
  extra?: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group flex min-h-[112px] flex-col rounded-sm border border-ink-200 bg-ink-50 p-4 hover:border-brand-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500"
    >
      <span className="truncate text-xs font-medium uppercase tracking-wide text-ink-500">{label}</span>
      <div className="mt-1 flex items-end justify-between gap-2">
        <div className="text-2xl font-bold leading-tight tabular-nums text-ink-900">{value}</div>
        {extra}
      </div>
      {chip && <div className="mt-1.5">{chip}</div>}
      <div className="mt-1.5 space-y-0.5 text-xs leading-snug text-ink-500">
        {lines.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
    </Link>
  );
}

function Pill({ tone, children }: { tone: "ok" | "watch" | "info"; children: React.ReactNode }) {
  const cls = {
    ok: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
    watch: "bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300",
    info: "bg-ink-200 text-ink-700",
  }[tone];
  return <span className={`inline-flex items-center whitespace-nowrap rounded-sm px-2 py-0.5 text-xs font-semibold ${cls}`}>{children}</span>;
}

function Kpis({ d, now }: { d: OwnerDashboardData; now: Date }) {
  const k = d.kpis;
  const snap = k.cash.snapshot;
  const cashAge = snap ? Math.floor((now.getTime() - snap.at.getTime()) / DAY) : null;
  const cashStale = cashAge != null && cashAge > 14;
  const delta = snap && snap.prevAmount != null ? snap.amount - snap.prevAmount : null;
  const m = k.margin;
  const belowTarget = m.marginPct != null && m.targetPct != null && m.marginPct < m.targetPct - 2;
  const netMovement = k.cash.netMovement;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 min-[1280px]:grid-cols-6">
      <Kpi
        label="Signed backlog"
        href="/projects"
        value={<Fig>{phpCompact(k.backlog.remaining)}</Fig>}
        lines={[
          `${k.backlog.projects} project${k.backlog.projects === 1 ? "" : "s"} in construction`,
          k.backlog.projects > 0 ? (
            <span key="c">
              <Fig>{phpCompact(k.backlog.contract)}</Fig> contract · remaining after progress
            </span>
          ) : (
            "Nothing under construction yet"
          ),
          k.backlog.prospectiveCount > 0 ? (
            <span key="p">
              + <Fig>{phpCompact(k.backlog.prospectiveValue)}</Fig> prospective ({k.backlog.prospectiveCount} at site survey)
            </span>
          ) : (
            ""
          ),
        ]}
      />
      <Kpi
        label="Forecast profit"
        href="/finance"
        value={
          m.profit == null ? (
            <span className="text-base font-semibold text-ink-600">Pending cost data</span>
          ) : (
            <Fig>{phpCompact(m.profit)}</Fig>
          )
        }
        chip={
          m.profit == null ? (
            <Pill tone="info">Unverified</Pill>
          ) : m.covered < m.total ? (
            <Pill tone="watch">Partial</Pill>
          ) : belowTarget ? (
            <Pill tone="watch">▼ Below target</Pill>
          ) : (
            <Pill tone="ok">Estimate</Pill>
          )
        }
        lines={
          m.profit == null
            ? ["Costs aren’t recorded against progress yet — no margin is shown rather than a misleading 100%."]
            : [
                <span key="m">
                  <FigPlain>{m.marginPct!.toFixed(1)}%</FigPlain> margin
                  {m.targetPct != null && (
                    <>
                      {" "}
                      vs <FigPlain>{m.targetPct.toFixed(0)}%</FigPlain> target
                    </>
                  )}
                </span>,
                `Based on ${m.covered} of ${m.total} projects (${m.coveredContractPct.toFixed(0)}% of contract value)`,
              ]
        }
      />
      <Kpi
        label={snap ? "Cash on hand" : "Net cash flow"}
        href="/finance"
        value={
          snap ? (
            <Fig>{phpCompact(snap.amount)}</Fig>
          ) : (
            <Fig>{`${netMovement < 0 ? "−" : ""}${phpCompact(Math.abs(netMovement))}`}</Fig>
          )
        }
        chip={snap ? cashStale ? <Pill tone="watch">Stale</Pill> : <Pill tone="ok">✓ Recent</Pill> : <Pill tone="info">Not a balance</Pill>}
        extra={snap ? <Sparkline values={snap.history} /> : undefined}
        lines={
          snap
            ? [
                `Manual bank check · ${ago(snap.at, now)}`,
                delta != null ? (
                  <span key="d">
                    <Fig>{`${delta >= 0 ? "+" : "−"}${phpCompact(Math.abs(delta))}`}</Fig> since previous check
                  </span>
                ) : (
                  "First balance recorded"
                ),
                k.cash.runway.weeksOfRunway != null ? `≈ ${k.cash.runway.weeksOfRunway.toFixed(0)} weeks runway at recent burn` : "",
              ].filter(Boolean)
            : [`Collected − committed · ${d.flows.label.toLowerCase()}`, "No bank balance recorded — add one in Finance"]
        }
      />
      <Kpi
        label="Receivables due"
        href="/finance"
        value={<Fig>{phpCompact(k.due.total)}</Fig>}
        chip={k.due.total > 0 ? <Pill tone="watch">● To collect</Pill> : <Pill tone="ok">✓ Nothing due</Pill>}
        lines={[
          `${k.due.terms} milestone${k.due.terms === 1 ? "" : "s"} · ${k.due.projects} project${k.due.projects === 1 ? "" : "s"}`,
          "No due dates recorded — lateness isn’t measured",
        ]}
      />
      <Kpi
        label="At-risk projects"
        href="/projects"
        value={
          <>
            {k.atRisk.count}
            <span className="text-base font-medium text-ink-500"> of {k.atRisk.total}</span>
          </>
        }
        chip={<SeverityChip severity={k.atRisk.critical > 0 ? 2 : k.atRisk.count > 0 ? 1 : 0} />}
        lines={[
          k.atRisk.top ? <FigText key="t">{k.atRisk.top}</FigText> : "No cost, schedule or reporting breaches",
          k.atRisk.critical > 0 ? `${k.atRisk.critical} critical` : "",
        ].filter(Boolean)}
      />
      <Kpi
        label="Critical issues"
        href="/instructions"
        value={k.pulse.open}
        chip={<SeverityChip severity={k.pulse.open > 0 ? 1 : 0} />}
        lines={[
          `${k.pulse.overdueInstructions} overdue instructions · ${k.pulse.criticalRequisitions} urgent requisitions · ${k.pulse.permitIssues} permit alerts`,
          "Safety incidents aren’t tracked yet",
        ]}
      />
    </div>
  );
}

function Attention({ items, total }: { items: AttentionItem[]; total: number }) {
  return (
    <Panel
      title="Needs attention"
      subtitle={total > 0 ? `Top ${items.length} of ${total} — ranked by severity, then value at stake` : "Nothing needs a decision right now"}
      className="min-[1280px]:col-span-7"
    >
      {items.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink-500">✓ No exceptions found across projects, cash, procurement or permits.</p>
      ) : (
        <div className="-mx-4 overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-ink-500">
                <th className="px-4 pb-2 font-semibold">Issue</th>
                <th className="px-2 pb-2 text-right font-semibold">Impact</th>
                <th className="px-2 pb-2 font-semibold">Owner</th>
                <th className="px-2 pb-2 font-semibold">When</th>
                <th className="px-4 pb-2" />
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.key} className="border-t border-ink-100 align-top">
                  <td className="px-4 py-2.5">
                    <div className="flex items-start gap-2">
                      <SeverityChip severity={it.severity} />
                      <div className="min-w-0">
                        <div className="font-medium text-ink-900">{it.title}</div>
                        <div className="text-xs text-ink-500">
                          <FigText>{it.detail}</FigText>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums">
                    {it.impactAmount != null ? (
                      <>
                        <Fig>{phpCompact(Math.abs(it.impactAmount))}</Fig>
                        <div className="text-[11px] text-ink-500">{it.impact}</div>
                      </>
                    ) : (
                      <span className="text-xs text-ink-500">{it.impact || "—"}</span>
                    )}
                  </td>
                  <td className="px-2 py-2.5 text-ink-700">{it.owner}</td>
                  <td className="whitespace-nowrap px-2 py-2.5 text-xs text-ink-600">{it.when}</td>
                  <td className="px-4 py-2.5 text-right">
                    <Link href={it.href} className="font-medium text-brand-600 hover:underline" aria-label={`Open ${it.title}`}>
                      Open →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const user = await getSessionUser();
  if (!user || user.role !== "OWNER") redirect("/attendance"); // Owner-only

  const filters = parseFilters(searchParams);
  const d = await getOwnerDashboard(filters);
  const now = d.generatedAt;

  const portfolio: PortfolioRow[] = d.rows.map((r) => ({
    id: r.id,
    name: r.name,
    clientName: r.clientName,
    statusLabel: r.statusLabel,
    manager: r.manager,
    isCompleted: r.isCompleted,
    isProspective: r.isProspective,
    contract: r.contract,
    committed: r.committed,
    pct: r.pct,
    lastProgressAt: r.lastProgressAt?.toISOString() ?? null,
    costState: r.costState,
    forecastCost: r.forecastCost,
    forecastProfit: r.forecastProfit,
    forecastMarginPct: r.forecastMarginPct,
    targetMarginPct: r.targetMarginPct,
    scheduleState: r.scheduleState,
    scheduleVarianceDays: r.scheduleVarianceDays,
    plannedPct: r.plannedPct,
    forecastFinish: r.forecastFinish?.toISOString() ?? null,
    severity: r.severity,
    deterioration: r.deterioration,
    topIssue: r.issues[0]?.label ?? null,
    nextAction: r.issues[0]?.nextAction ?? null,
  }));

  const f = d.flows;
  const collectedDelta = f.priorCollected > 0 ? ((f.collected - f.priorCollected) / f.priorCollected) * 100 : null;
  const net = f.collected - f.committedOut;
  const pr = d.procurement;

  return (
    <FigureVisibilityProvider>
      <div className="space-y-4 min-[1500px]:-mx-16">
        {/* Sticky header: filters, freshness, hide-figures */}
        <div className="z-10 -mx-4 space-y-2 border-b border-ink-200 bg-ink-100/95 px-4 py-3 backdrop-blur md:sticky md:top-0">
          <DashboardControls
            period={filters.period}
            scope={filters.scope}
            clientId={filters.clientId}
            clients={d.clients}
            updatedAt={now.toISOString()}
          />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-500">
            <span className="font-medium text-ink-600">Data freshness</span>
            {d.freshness.map((s) => {
              const age = s.at ? Math.floor((now.getTime() - s.at.getTime()) / DAY) : null;
              const stale = age == null || age > s.staleAfterDays;
              return (
                <span key={s.source} className={stale ? "font-medium text-amber-800 dark:text-amber-300" : ""}>
                  {stale ? "⚠ " : "✓ "}
                  {s.source}: {s.at ? ago(s.at, now) : "never recorded"}
                  {stale && s.at ? " — stale" : ""}
                </span>
              );
            })}
          </div>
        </div>

        <Kpis d={d} now={now} />

        <div className="grid grid-cols-1 gap-4 min-[1280px]:grid-cols-12">
          <Attention items={d.attention} total={d.attentionTotal} />

          <Panel
            title="Cash flow"
            subtitle={`${f.label} · collected vs committed cost (POs + payroll), by ${f.bucketing === "weekly" ? "week" : "month"}`}
            className="min-[1280px]:col-span-5"
          >
            <FlowChart data={f.buckets} />
            <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
              <div>
                <dt className="text-ink-500">Collected</dt>
                <dd className="text-sm font-semibold tabular-nums text-ink-900">
                  <Fig>{phpCompact(f.collected)}</Fig>
                </dd>
                {collectedDelta != null && (
                  <dd className="text-ink-500">
                    <FigPlain>
                      {collectedDelta >= 0 ? "▲" : "▼"} {Math.abs(collectedDelta).toFixed(0)}%
                    </FigPlain>{" "}
                    vs prior period
                  </dd>
                )}
              </div>
              <div>
                <dt className="text-ink-500">Committed cost</dt>
                <dd className="text-sm font-semibold tabular-nums text-ink-900">
                  <Fig>{phpCompact(f.committedOut)}</Fig>
                </dd>
                <dd className="text-ink-500">POs raised + payroll</dd>
              </div>
              <div>
                <dt className="text-ink-500">Net</dt>
                <dd className="text-sm font-semibold tabular-nums text-ink-900">
                  <Fig>{`${net < 0 ? "−" : ""}${phpCompact(Math.abs(net))}`}</Fig>
                </dd>
                <dd className="text-ink-500">collected − committed</dd>
              </div>
            </dl>
            <p className="mt-3 text-[11px] leading-snug text-ink-500">
              Bars are discrete amounts per period, not a smoothed trend. Committed cost is counted when a PO or payroll run is raised,
              not when cash leaves the bank, so it isn’t presented as a bank balance.
            </p>
          </Panel>
        </div>

        <Panel
          title={filters.scope === "all" ? "Project portfolio — all projects" : "Active project portfolio"}
          subtitle={`${d.rows.length} project${d.rows.length === 1 ? "" : "s"} · sorted by risk, then margin deterioration · click a header to re-sort, a row to open`}
          action={
            <Link href="/projects" className="text-xs font-medium text-brand-600 hover:underline">
              All projects →
            </Link>
          }
        >
          {portfolio.length === 0 ? (
            <div className="py-8 text-center text-sm text-ink-600">
              <p className="font-medium text-ink-800">No projects are in construction right now.</p>
              {d.kpis.backlog.prospectiveCount > 0 && (
                <p className="mt-1">
                  {d.kpis.backlog.prospectiveCount} prospective project{d.kpis.backlog.prospectiveCount === 1 ? " is" : "s are"} at site survey
                  (<Fig>{phpCompact(d.kpis.backlog.prospectiveValue)}</Fig>).{" "}
                  <Link href="?scope=all" className="font-medium text-brand-600 hover:underline">
                    Show prospective &amp; completed projects
                  </Link>
                </p>
              )}
            </div>
          ) : (
            <div className="-mx-4 -mt-4">
              <PortfolioTable rows={portfolio} />
            </div>
          )}
          <p className="mt-4 text-[11px] leading-snug text-ink-500">
            Cost to date = approved requisitions, POs and approved/paid payroll (there is no separate actual-cost ledger yet). Forecast cost
            = cost to date ÷ weighted progress, shown only once both exist; under 10% complete it is marked an early estimate and left out
            of the headline margin. The schedule forecast extrapolates elapsed time against progress.
          </p>
        </Panel>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Panel title="Receivables & retention" subtitle="Milestones marked Due, net of payments recorded against them">
            {d.dueTerms.length === 0 ? (
              <p className="text-sm text-ink-500">✓ No billing milestones are currently due.</p>
            ) : (
              <BarList
                tone="amber"
                items={d.dueTerms.map((t) => ({ label: t.projectName, sub: `${t.clientName} · ${t.label}`, value: t.outstanding }))}
              />
            )}
            <div className="mt-4 border-t border-ink-100 pt-3">
              <div className="mb-2 flex items-baseline justify-between text-xs">
                <span className="font-semibold uppercase tracking-wide text-ink-500">Retention held by clients</span>
                <span className="text-sm font-semibold tabular-nums text-ink-900">
                  <Fig>{phpCompact(d.retention.total)}</Fig>
                </span>
              </div>
              {d.retention.rows.length === 0 ? (
                <p className="text-sm text-ink-500">No retention outstanding.</p>
              ) : (
                <BarList tone="oxide" items={d.retention.rows.map((r) => ({ label: r.projectName, sub: r.clientName, value: r.amount }))} />
              )}
            </div>
            <p className="mt-3 text-[11px] text-ink-500">Retention release dates aren’t recorded yet, so aging can’t be shown.</p>
          </Panel>

          <Panel title="Commitments & procurement" subtitle="Company-wide · approved vs pending, and delivery exposure">
            <BarList
              items={[
                {
                  label: "Awaiting approval",
                  sub: `${pr.pendingApproval.count} requisitions${pr.pendingApproval.noEstimate ? `, ${pr.pendingApproval.noEstimate} without estimate` : ""}`,
                  value: pr.pendingApproval.amount,
                },
                { label: "Approved, no PO yet", sub: `${pr.approvedNoPo.count} requisitions`, value: pr.approvedNoPo.amount },
                { label: "Open purchase orders", sub: `${pr.openPos.count} POs not fully delivered`, value: pr.openPos.amount },
              ]}
            />
            <div className="mt-4 rounded-sm bg-ink-100 px-3 py-2 text-xs text-ink-700">
              {pr.lateDeliveries.count > 0 ? (
                <>
                  ● <strong>{pr.lateDeliveries.count}</strong> PO{pr.lateDeliveries.count === 1 ? "" : "s"} past delivery date —{" "}
                  <Fig>{phpCompact(pr.lateDeliveries.amount)}</Fig> of materials not yet received.
                </>
              ) : (
                <>✓ No open purchase orders are past their delivery date.</>
              )}
            </div>
          </Panel>

          <Panel title="Backlog & pipeline" subtitle="Signed work is kept separate from unawarded opportunities">
            <div className="mb-3 grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-sm bg-ink-100 px-3 py-2">
                <div className="text-ink-500">Signed backlog (contracted)</div>
                <div className="text-base font-semibold tabular-nums text-ink-900">
                  <Fig>{phpCompact(d.kpis.backlog.remaining)}</Fig>
                </div>
              </div>
              <div className="rounded-sm bg-ink-100 px-3 py-2">
                <div className="text-ink-500">Prospective projects (site survey)</div>
                <div className="text-base font-semibold tabular-nums text-ink-900">
                  <Fig>{phpCompact(d.pipeline.prospectiveProjects.value)}</Fig>
                  <span className="ml-1 text-xs font-normal text-ink-500">· {d.pipeline.prospectiveProjects.count}</span>
                </div>
              </div>
            </div>
            <BarList
              tone="amber"
              items={d.pipeline.stages.map((s) => ({ label: s.label, sub: `${s.count} bid${s.count === 1 ? "" : "s"}`, value: s.value }))}
            />
            <p className="mt-3 text-[11px] text-ink-500">
              Quoted value, not revenue. Stage-weighted estimate: <Fig>{phpCompact(d.pipeline.weighted)}</Fig> (standard funnel weights
              {d.pipeline.winRate != null && (
                <>
                  ; win rate <FigPlain>{d.pipeline.winRate.toFixed(0)}%</FigPlain>
                </>
              )}
              ).
            </p>
          </Panel>

          <Panel title="Workforce & operations" subtitle="What is tracked today">
            <dl className="space-y-2 text-[13px]">
              {(
                [
                  ["On duty right now", d.operations.onDuty, "/attendance"],
                  ["Overtime / early-start requests to decide", d.operations.pendingTimeRequests, "/attendance"],
                  ["Payroll runs awaiting approval", d.operations.unapprovedPayroll, "/payroll"],
                  ["Site instructions past due", d.operations.overdueInstructions, "/instructions"],
                  ["Permits expired or expiring in 30 days", d.operations.permitIssues, "/people"],
                ] as const
              ).map(([label, n, href]) => (
                <div key={label} className="flex items-center justify-between gap-3 border-b border-ink-100 pb-2 last:border-0">
                  <dt className="text-ink-700">{label}</dt>
                  <dd>
                    <Link href={href} className="font-semibold tabular-nums text-brand-600 hover:underline">
                      {n}
                    </Link>
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-[11px] leading-snug text-ink-500">
              Safety incidents, near misses, rework and labor productivity aren’t captured in Maxey Ops yet. They’ll appear here once the
              data exists, instead of showing an empty or invented score.
            </p>
          </Panel>
        </div>

        <Panel title="Non-project expenses" subtitle="Emergency, office and warehouse purchases — not counted in any project’s cost or margin">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {d.nonProject.map((c) => (
              <div key={c.label} className="rounded-sm bg-ink-100 px-3 py-2">
                <div className="text-xs text-ink-500">{c.label}</div>
                <div className="text-base font-semibold tabular-nums text-ink-900">
                  <Fig>{phpCompact(c.total)}</Fig>
                </div>
                <div className="text-[11px] text-ink-500">
                  {c.count} approved requisition{c.count === 1 ? "" : "s"}
                </div>
              </div>
            ))}
            <div className="rounded-sm bg-brand-50 px-3 py-2">
              <div className="text-xs text-ink-500">Total non-project</div>
              <div className="text-base font-semibold tabular-nums text-ink-900">
                <Fig>{phpCompact(d.nonProjectTotal)}</Fig>
              </div>
              <Link href="/requisitions" className="text-[11px] font-medium text-brand-600 hover:underline">
                View requisitions →
              </Link>
            </div>
          </div>
        </Panel>

        <Panel title="Completed & turned-over projects" subtitle="Closeout results — final cost against contract">
          {d.completedRows.length === 0 ? (
            <p className="text-sm text-ink-500">No turned-over projects match the current filters.</p>
          ) : (
            <div className="-mx-4 overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-ink-500">
                    <th className="px-4 pb-2 font-semibold">Project</th>
                    <th className="px-2 pb-2 text-right font-semibold">Contract</th>
                    <th className="px-2 pb-2 text-right font-semibold">Final cost</th>
                    <th className="px-2 pb-2 text-right font-semibold">Final margin</th>
                    <th className="px-2 pb-2 text-right font-semibold">vs target</th>
                    <th className="px-4 pb-2 text-right font-semibold">Collected</th>
                  </tr>
                </thead>
                <tbody>
                  {d.completedRows.map((r) => (
                    <tr key={r.id} className="border-t border-ink-100">
                      <td className="px-4 py-2">
                        <Link href={`/projects/${r.id}`} className="font-medium text-brand-600 hover:underline">
                          {r.name}
                        </Link>
                        <div className="text-xs text-ink-500">{r.clientName}</div>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        <Fig>{phpCompact(r.contract)}</Fig>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {r.committed > 0 ? <Fig>{phpCompact(r.committed)}</Fig> : <span className="text-xs text-ink-500">Not reported</span>}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {r.forecastMarginPct != null ? (
                          <FigPlain>{r.forecastMarginPct.toFixed(1)}%</FigPlain>
                        ) : (
                          <span className="text-xs text-ink-500">Pending cost data</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {r.forecastMarginPct != null && r.targetMarginPct != null ? (
                          <FigPlain>{`${r.forecastMarginPct - r.targetMarginPct >= 0 ? "+" : "−"}${Math.abs(r.forecastMarginPct - r.targetMarginPct).toFixed(1)} pts`}</FigPlain>
                        ) : (
                          <span className="text-xs text-ink-500">No target set</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        <FigPlain>{r.contract > 0 ? `${((r.received / r.contract) * 100).toFixed(0)}%` : "—"}</FigPlain>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </FigureVisibilityProvider>
  );
}
