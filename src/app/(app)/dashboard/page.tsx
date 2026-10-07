import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMonthlyCashflow, getNonProjectExpenses, getProjectFinances, type ProjectFinance } from "@/lib/finance";
import { php, phpCompact } from "@/lib/format";
import { COMPLETED_STATUSES } from "@/lib/project-status";
import { Badge, Card, CardBody, CardHeader, Stat, Table, Td, Th } from "@/components/ui";
import { CashflowChart } from "@/components/charts";
import { Fig, FigChart, FigPlain, FigureToggle, FigureVisibilityProvider } from "@/components/figure-visibility";

export const metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

function sumFinances(rows: ProjectFinance[]) {
  return rows.reduce(
    (acc, f) => ({
      contract: acc.contract + f.contractValue,
      received: acc.received + f.received,
      committed: acc.committed + f.committedCost,
      retention: acc.retention + f.retentionHeld,
      margin: acc.margin + f.grossMargin,
    }),
    { contract: 0, received: 0, committed: 0, retention: 0, margin: 0 }
  );
}

export default async function DashboardPage() {
  const user = await getSessionUser();
  if (!user || user.role !== "OWNER") redirect("/attendance"); // Owner-only

  const [finances, cashflow, nonProjectExpenses, pendingReqs, newLeads, pendingCOs] = await Promise.all([
    getProjectFinances(),
    getMonthlyCashflow(6),
    getNonProjectExpenses(),
    prisma.requisition.count({ where: { status: { in: ["SUBMITTED", "UNDER_REVIEW"] } } }),
    prisma.lead.count({ where: { status: "NEW" } }),
    prisma.changeOrder.count({ where: { status: "PENDING_CLIENT" } }),
  ]);

  const doneFinances = finances.filter((f) => (COMPLETED_STATUSES as string[]).includes(f.status));
  const activeFinances = finances.filter((f) => !(COMPLETED_STATUSES as string[]).includes(f.status));
  const active = sumFinances(activeFinances);
  const done = sumFinances(doneFinances);

  return (
    <FigureVisibilityProvider>
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-ink-900">Owner Dashboard</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <FigureToggle />
          {pendingReqs > 0 && (
            <Link
              href="/requisitions"
              className="rounded-lg bg-amber-100 px-3 py-1.5 font-medium text-amber-800 hover:bg-amber-200"
            >
              {pendingReqs} requisition{pendingReqs === 1 ? "" : "s"} awaiting action
            </Link>
          )}
          {newLeads > 0 && (
            <Link
              href="/leads"
              className="rounded-lg bg-blue-100 px-3 py-1.5 font-medium text-blue-800 hover:bg-blue-200"
            >
              {newLeads} new lead{newLeads === 1 ? "" : "s"}
            </Link>
          )}
          {pendingCOs > 0 && (
            <span className="rounded-lg bg-violet-100 px-3 py-1.5 font-medium text-violet-800">
              {pendingCOs} change order{pendingCOs === 1 ? "" : "s"} with client
            </span>
          )}
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-500">
          Active projects ({activeFinances.length})
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Stat label="Contract value" value={<Fig>{phpCompact(active.contract)}</Fig>} sub="active projects" />
          <Stat label="Received" value={<Fig>{phpCompact(active.received)}</Fig>} tone="good" sub="client payments" />
          <Stat
            label="Committed cost"
            value={<Fig>{phpCompact(active.committed)}</Fig>}
            tone="bad"
            sub="approved reqs + POs + payroll"
          />
          <Stat
            label="Est. gross margin"
            value={<Fig>{phpCompact(active.margin)}</Fig>}
            tone={active.margin >= 0 ? "good" : "bad"}
            sub={active.contract > 0 ? <FigPlain>{`${((active.margin / active.contract) * 100).toFixed(1)}% of contract`}</FigPlain> : undefined}
          />
          <Stat label="Retention held" value={<Fig>{phpCompact(active.retention)}</Fig>} tone="warning" sub="by clients" />
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-500">
          Completed / turned-over projects ({doneFinances.length})
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Stat label="Contract value" value={<Fig>{phpCompact(done.contract)}</Fig>} sub="done projects" />
          <Stat label="Received" value={<Fig>{phpCompact(done.received)}</Fig>} tone="good" sub="client payments" />
          <Stat
            label="Committed cost"
            value={<Fig>{phpCompact(done.committed)}</Fig>}
            tone="bad"
            sub="approved reqs + POs + payroll"
          />
          <Stat
            label="Est. gross margin"
            value={<Fig>{phpCompact(done.margin)}</Fig>}
            tone={done.margin >= 0 ? "good" : "bad"}
            sub={done.contract > 0 ? <FigPlain>{`${((done.margin / done.contract) * 100).toFixed(1)}% of contract`}</FigPlain> : undefined}
          />
          <Stat label="Retention held" value={<Fig>{phpCompact(done.retention)}</Fig>} tone="warning" sub="by clients" />
        </div>
      </div>

      <Card className="border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/30">
        <CardHeader
          title="Non-project expenses"
          subtitle="Emergency, office, and warehouse-supply purchases — not counted toward any project's contract, cost, or margin above"
          action={
            <Link
              href="/requisitions"
              className="text-xs font-medium text-brand-600 hover:underline"
            >
              View requisitions →
            </Link>
          }
        />
        <CardBody>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {nonProjectExpenses.byCategory.map((c) => (
              <Stat
                key={c.category}
                label={c.label}
                value={<Fig>{phpCompact(c.total)}</Fig>}
                sub={`${c.count} requisition${c.count === 1 ? "" : "s"}`}
              />
            ))}
            <Stat
              label="Total non-project"
              value={<Fig>{phpCompact(nonProjectExpenses.total)}</Fig>}
              tone="brand"
              sub="emergency + office + warehouse"
            />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Company cashflow"
          subtitle="Client payments received vs. committed cost (POs + payroll), last 6 months"
        />
        <CardBody>
          <FigChart>
            <CashflowChart data={cashflow} />
          </FigChart>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Projects" subtitle="Per-project financial position" />
        <Table>
          <thead>
            <tr>
              <Th>Project</Th>
              <Th>Status</Th>
              <Th className="text-right">Contract</Th>
              <Th className="text-right">Received</Th>
              <Th className="text-right">Committed</Th>
              <Th className="text-right">Margin</Th>
              <Th className="text-right">Progress</Th>
            </tr>
          </thead>
          <tbody>
            {finances.map((f) => (
              <tr key={f.id} className="hover:bg-ink-50">
                <Td>
                  <Link href={`/projects/${f.id}`} className="font-medium text-brand-600 hover:underline">
                    {f.name}
                  </Link>
                  <div className="text-xs text-ink-400">{f.clientName}</div>
                </Td>
                <Td>
                  <Badge value={f.status} />
                </Td>
                <Td className="text-right tabular-nums"><Fig>{php(f.contractValue)}</Fig></Td>
                <Td className="text-right tabular-nums text-emerald-700"><Fig>{php(f.received)}</Fig></Td>
                <Td className="text-right tabular-nums"><Fig>{php(f.committedCost)}</Fig></Td>
                <Td
                  className={`text-right tabular-nums font-medium ${f.grossMargin >= 0 ? "text-emerald-700" : "text-red-600"}`}
                >
                  <Fig>{php(f.grossMargin)}</Fig>
                  <div className="text-xs font-normal text-ink-400"><FigPlain>{f.marginPct.toFixed(1)}%</FigPlain></div>
                </Td>
                <Td className="text-right tabular-nums">{f.accomplishmentPct.toFixed(0)}%</Td>
              </tr>
            ))}
            {finances.length === 0 && (
              <tr>
                <Td colSpan={7} className="py-8 text-center text-ink-400">
                  No projects yet — convert a won lead to get started.
                </Td>
              </tr>
            )}
          </tbody>
        </Table>
      </Card>
    </div>
    </FigureVisibilityProvider>
  );
}
