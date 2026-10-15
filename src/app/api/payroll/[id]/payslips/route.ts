import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import { normalizeEntries, type PayrollEntry } from "@/lib/payroll";
import { buildPayslip, slipFileName } from "@/lib/payslip";
import { buildPayslipsPdf } from "@/lib/payslip-pdf";
import { ensureSlipRefs } from "@/lib/payslip-refs";

/**
 * GET /api/payroll/[id]/payslips — payslips in the company's own form, once the run is approved.
 *  - Owner / Accounting / PM: every payslip in the run, A4 portrait with two per sheet, ready to print and cut.
 *    `?only=<userId>` gives a single person's slip instead.
 *  - Anyone else on staff: only their own payslip, on a half-A4 page.
 *  - `?inline=1` opens the PDF in the browser (for printing) instead of downloading it.
 * Works for every kind of run — office, drivers, architects/engineers and project (site crew) runs. Nothing is
 * recalculated here: a payslip shows exactly what the approved register says.
 */
export const GET = handleApi(async (req: NextRequest, { params }: { params: { id: string } }) => {
  const user = await requireUser();
  if (user.role === "CLIENT") throw new ApiError(403, "Not authorized");
  const isPayrollAdmin = ["OWNER", "ACCOUNTING", "PM"].includes(user.role);
  const url = new URL(req.url);
  const only = url.searchParams.get("only");
  const inline = url.searchParams.get("inline") === "1";

  const found = await prisma.payrollRun.findUnique({ where: { id: params.id }, include: { project: { select: { name: true } } } });
  if (!found) throw new ApiError(404, "Payroll run not found");
  if (found.status !== "APPROVED" && found.status !== "PAID") {
    throw new ApiError(409, "Payslips are available once the payroll is approved");
  }

  // Fill in any missing reference numbers (a no-op once they exist), then use the saved run.
  const run = (await ensureSlipRefs(found.id)) ?? found;
  let entries = normalizeEntries(run.entries as unknown as PayrollEntry[]);
  if (!isPayrollAdmin) {
    entries = entries.filter((e) => e.userId === user.id);
    if (entries.length === 0) throw new ApiError(403, "You're not on this payroll run");
  } else if (only) {
    entries = entries.filter((e) => e.userId === only);
    if (entries.length === 0) throw new ApiError(404, "That person isn't on this payroll run");
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));

  const people = await prisma.user.findMany({
    where: { id: { in: entries.map((e) => e.userId) } },
    select: { id: true, employeeNo: true, position: true, department: true },
  });
  const byId = new Map(people.map((p) => [p.id, p]));

  // Older approved runs predate the stored approval details — fall back to the audit trail.
  let approvedByName = run.approvedByName;
  if (!approvedByName) {
    const log = await prisma.auditLog.findFirst({ where: { entityType: "PayrollRun", entityId: run.id, action: "PAYROLL_APPROVED" }, orderBy: { createdAt: "desc" }, select: { actorName: true } });
    approvedByName = log?.actorName ?? null;
  }

  const slips = entries.map((e) =>
    buildPayslip(
      e,
      { employeeNo: byId.get(e.userId)?.employeeNo ?? null, position: byId.get(e.userId)?.position ?? null, department: byId.get(e.userId)?.department ?? null },
      { periodStart: run.periodStart, periodEnd: run.periodEnd, projectName: found.project?.name ?? null, approvedByName }
    )
  );

  const single = !isPayrollAdmin || !!only;
  const scope = found.project?.name ?? run.department ?? "payroll";
  const pdfBytes = await buildPayslipsPdf(slips, single ? "single" : "a4-two-up", `Payslips — ${scope} — ${slips[0]?.periodLabel ?? ""}`);

  await audit({
    entityType: "PayrollRun",
    entityId: run.id,
    actorId: user.id,
    actorName: user.name,
    action: isPayrollAdmin ? "PAYROLL_PAYSLIPS_DOWNLOADED" : "PAYSLIP_DOWNLOADED",
    diff: { scope, workers: entries.length, printView: inline },
  });

  const filename = slipFileName(single && slips.length === 1 ? slips[0].name : scope, run.periodEnd, single);
  return new NextResponse(Buffer.from(pdfBytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
});
