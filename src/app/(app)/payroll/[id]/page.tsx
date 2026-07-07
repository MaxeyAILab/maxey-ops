import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fmtDate, fmtDateTime, php } from "@/lib/format";
import type { PayrollEntry } from "@/lib/payroll";
import { Badge, Card, CardBody, CardHeader, Table, Td, Th } from "@/components/ui";
import { PayrollStatusButtons } from "@/components/payroll-actions";
import { PrintButton } from "@/components/print-button";

export const dynamic = "force-dynamic";

/** Payroll register — Owner + Accounting only (Spec 6.5). */
export default async function PayrollRunPage({ params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user || !["OWNER", "ACCOUNTING"].includes(user.role)) redirect("/payroll");

  const run = await prisma.payrollRun.findUnique({
    where: { id: params.id },
    include: { project: { select: { name: true } } },
  });
  if (!run) notFound();

  const entries = run.entries as unknown as PayrollEntry[];
  const totals = entries.reduce(
    (acc, e) => ({
      gross: acc.gross + e.gross,
      deductions: acc.deductions + e.sss + e.philhealth + e.pagibig,
      net: acc.net + e.net,
    }),
    { gross: 0, deductions: 0, net: 0 }
  );

  const auditTrail = await prisma.auditLog.findMany({
    where: { entityType: "PayrollRun", entityId: run.id },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="space-y-6">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/payroll" className="text-xs text-ink-400 hover:text-ink-600">
            ← All runs
          </Link>
          <h1 className="text-xl font-bold text-ink-900">
            {run.project?.name ?? `${run.department} Department`} Payroll —{" "}
            {fmtDate(run.periodStart)} to {fmtDate(run.periodEnd)}
          </h1>
          {run.project && (
            <p className="text-xs text-ink-500">
              Approved runs post as labor cost into this project&apos;s committed cost.
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Badge value={run.status} />
          <a
            href={`/api/payroll/${run.id}/export`}
            className="rounded-lg border border-ink-200 px-3 py-2 text-sm font-medium text-ink-700 hover:bg-ink-50"
          >
            ⬇ Export CSV
          </a>
          <PrintButton label="Print register" />
        </div>
      </div>

      <Card>
        <CardHeader
          title="Payroll register"
          subtitle="OT at 1.25×; SSS/PhilHealth/Pag-IBIG figures are configurable placeholders"
        />
        <Table>
          <thead>
            <tr>
              <Th>Worker</Th>
              <Th className="text-right">Days</Th>
              <Th className="text-right">Reg hrs</Th>
              <Th className="text-right">OT hrs</Th>
              <Th className="text-right">Rate/hr</Th>
              <Th className="text-right">Gross</Th>
              <Th className="text-right">SSS</Th>
              <Th className="text-right">PhilHealth</Th>
              <Th className="text-right">Pag-IBIG</Th>
              <Th className="text-right">Net pay</Th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.userId}>
                <Td className="font-medium">{e.name}</Td>
                <Td className="text-right tabular-nums">{e.daysWorked}</Td>
                <Td className="text-right tabular-nums">{e.regularHours}</Td>
                <Td className="text-right tabular-nums">{e.otHours}</Td>
                <Td className="text-right tabular-nums">{php(e.hourlyRate)}</Td>
                <Td className="text-right tabular-nums">{php(e.gross)}</Td>
                <Td className="text-right tabular-nums text-ink-500">{php(e.sss)}</Td>
                <Td className="text-right tabular-nums text-ink-500">{php(e.philhealth)}</Td>
                <Td className="text-right tabular-nums text-ink-500">{php(e.pagibig)}</Td>
                <Td className="text-right font-semibold tabular-nums text-emerald-700">
                  {php(e.net)}
                </Td>
              </tr>
            ))}
            <tr className="bg-ink-50 font-semibold">
              <Td colSpan={5}>TOTAL ({entries.length} workers)</Td>
              <Td className="text-right tabular-nums">{php(totals.gross)}</Td>
              <Td colSpan={3} className="text-right tabular-nums text-ink-500">
                {php(totals.deductions)}
              </Td>
              <Td className="text-right tabular-nums text-emerald-700">{php(totals.net)}</Td>
            </tr>
          </tbody>
        </Table>
        <CardBody className="no-print border-t border-ink-100">
          <PayrollStatusButtons runId={run.id} status={run.status} />
        </CardBody>
      </Card>

      <Card className="no-print">
        <CardHeader title="Audit trail" />
        <CardBody>
          <ol className="space-y-2 text-sm">
            {auditTrail.map((a) => (
              <li key={a.id} className="flex gap-3">
                <span className="whitespace-nowrap text-xs tabular-nums text-ink-400">
                  {fmtDateTime(a.createdAt)}
                </span>
                <span className="text-ink-700">
                  <span className="font-medium">{a.actorName}</span> —{" "}
                  {a.action.replace(/_/g, " ").toLowerCase()}
                </span>
              </li>
            ))}
          </ol>
        </CardBody>
      </Card>
    </div>
  );
}
