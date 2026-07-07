import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import type { PayrollEntry } from "@/lib/payroll";

/**
 * GET /api/payroll/[id]/export — payroll register as CSV (opens in Excel)
 * for bank disbursement or cash payout sheets (Spec 6.5).
 */
export const GET = handleApi(
  async (_req: NextRequest, { params }: { params: { id: string } }) => {
    const user = await requireUser(["OWNER", "ACCOUNTING"]);
    const run = await prisma.payrollRun.findUnique({
      where: { id: params.id },
      include: { project: { select: { name: true } } },
    });
    if (!run) throw new ApiError(404, "Payroll run not found");

    const entries = run.entries as unknown as PayrollEntry[];
    const header = [
      "Name",
      "Days Worked",
      "Regular Hours",
      "OT Hours",
      "Hourly Rate",
      "Gross",
      "SSS",
      "PhilHealth",
      "Pag-IBIG",
      "Net Pay",
    ];
    const rows = entries.map((e) => [
      `"${e.name.replace(/"/g, '""')}"`,
      e.daysWorked,
      e.regularHours,
      e.otHours,
      e.hourlyRate,
      e.gross,
      e.sss,
      e.philhealth,
      e.pagibig,
      e.net,
    ]);
    const total = entries.reduce((s, e) => s + e.net, 0);
    const csv = [
      `Maxey Construction — ${run.project?.name ?? run.department} Payroll Register`,
      `Period,${run.periodStart.toISOString().slice(0, 10)},to,${run.periodEnd.toISOString().slice(0, 10)},Status,${run.status}`,
      "",
      header.join(","),
      ...rows.map((r) => r.join(",")),
      "",
      `TOTAL NET,,,,,,,,,${Math.round(total * 100) / 100}`,
    ].join("\r\n");

    await audit({
      entityType: "PayrollRun",
      entityId: run.id,
      actorId: user.id,
      actorName: user.name,
      action: "PAYROLL_EXPORTED",
    });

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="payroll-${(run.project?.name ?? run.department ?? "run").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${run.periodStart.toISOString().slice(0, 10)}.csv"`,
      },
    });
  }
);
