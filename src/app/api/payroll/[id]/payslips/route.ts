import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { fmtDate } from "@/lib/format";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import { normalizeEntries, type PayrollEntry } from "@/lib/payroll";
import { buildOfficePayslipsPdf } from "@/lib/office-payslip-pdf";

/**
 * GET /api/payroll/[id]/payslips — individual cut-slips for an Office/Driver
 * (non-project) payroll run, in the company's own payslip form. Project
 * (site-crew) runs don't use this format — only Office/Driver. Owner/
 * Accounting/PM get every slip in the run (one PDF, ready to print and cut);
 * anyone else only gets their own line, and only if they're actually on it.
 */
export const GET = handleApi(
  async (_req: NextRequest, { params }: { params: { id: string } }) => {
    const user = await requireUser();
    if (user.role === "CLIENT") throw new ApiError(403, "Not authorized");
    const isPayrollAdmin = ["OWNER", "ACCOUNTING", "PM"].includes(user.role);

    const run = await prisma.payrollRun.findUnique({ where: { id: params.id } });
    if (!run) throw new ApiError(404, "Payroll run not found");
    if (run.department !== "OFFICE" && run.department !== "DRIVER") {
      throw new ApiError(400, "Payslips are only available for Office/Driver payroll runs");
    }

    let entries = normalizeEntries(run.entries as unknown as PayrollEntry[]);
    if (!isPayrollAdmin) {
      entries = entries.filter((e) => e.userId === user.id);
      if (entries.length === 0) throw new ApiError(403, "You're not on this payroll run");
    }

    const pdfBytes = await buildOfficePayslipsPdf({
      title: `${run.department} Payroll — ${fmtDate(run.periodStart)} to ${fmtDate(run.periodEnd)}`,
      slips: entries.map((e) => ({
        name: e.name,
        department: run.department!,
        gross: e.gross,
        contri: e.sss + e.philhealth + e.pagibig,
        meals: e.meals,
        cashAdvance: e.cashAdvance,
        net: e.net,
      })),
    });

    await audit({
      entityType: "PayrollRun",
      entityId: run.id,
      actorId: user.id,
      actorName: user.name,
      action: "PAYROLL_PAYSLIPS_DOWNLOADED",
      diff: { department: run.department, workers: entries.length },
    });

    const filename = `payslips-${run.department!.toLowerCase()}-${run.periodStart.toISOString().slice(0, 10)}.pdf`;
    return new NextResponse(Buffer.from(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }
);
