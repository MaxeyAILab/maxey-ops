import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMonthlyCashflow, getProjectFinances } from "@/lib/finance";
import { php, phpCompact } from "@/lib/format";
import { Badge, Card, CardBody, CardHeader, Stat, Table, Td, Th } from "@/components/ui";
import { CashflowChart } from "@/components/charts";

export const metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getSessionUser();
  if (!user || user.role !== "OWNER") redirect("/attendance"); // Owner-only

  const [finances, cashflow, pendingReqs, newLeads, pendingCOs] = await Promise.all([
    getProjectFinances(),
    getMonthlyCashflow(6),
    prisma.requisition.count({ where: { status: { in: ["SUBMITTED", "UNDER_REVIEW"] } } }),
    prisma.lead.count({ where: { status: "NEW" } }),
    prisma.changeOrder.count({ where: { status: "PENDING_CLIENT" } }),
  ]);

  const total = finances.reduce(
    (acc, f) => ({
      contract: acc.contract + f.contractValue,
      received: acc.received + f.received,
      committed: acc.committed + f.committedCost,
      retention: acc.retention + f.retentionHeld,
      margin: acc.margin + f.grossMargin,
    }),
    { contract: 0, received: 0, committed: 0, retention: 0, margin: 0 }
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-ink-900">Owner Dashboard</h1>
        <div className="flex gap-2 text-sm">
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

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Contract value" value={phpCompact(total.contract)} sub="active projects" />
        <Stat label="Received" value={phpCompact(total.received)} tone="good" sub="client payments" />
        <Stat label="Committed cost" value={phpCompact(total.committed)} sub="approved reqs + POs" />
        <Stat
          label="Est. gross margin"
          value={phpCompact(total.margin)}
          tone={total.margin >= 0 ? "good" : "bad"}
          sub={total.contract > 0 ? `${((total.margin / total.contract) * 100).toFixed(1)}% of contract` : undefined}
        />
        <Stat label="Retention held" value={phpCompact(total.retention)} tone="brand" sub="by clients" />
      </div>

      <Card>
        <CardHeader
          title="Company cashflow"
          subtitle="Client payments received vs. purchase-order commitments, last 6 months"
        />
        <CardBody>
          <CashflowChart data={cashflow} />
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
                <Td className="text-right tabular-nums">{php(f.contractValue)}</Td>
                <Td className="text-right tabular-nums text-emerald-700">{php(f.received)}</Td>
                <Td className="text-right tabular-nums">{php(f.committedCost)}</Td>
                <Td
                  className={`text-right tabular-nums font-medium ${f.grossMargin >= 0 ? "text-emerald-700" : "text-red-600"}`}
                >
                  {php(f.grossMargin)}
                  <div className="text-xs font-normal text-ink-400">{f.marginPct.toFixed(1)}%</div>
                </Td>
                <Td className="text-right tabular-nums">{f.latestProgressPct.toFixed(0)}%</Td>
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
  );
}
