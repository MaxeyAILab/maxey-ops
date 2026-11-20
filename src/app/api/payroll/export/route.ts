import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import { isPayrollFileKind, payrollFileName } from "@/lib/payroll-export";
import { buildPayrollWorkbook } from "@/lib/payroll-workbook";
import { loadPayrollWorkbook } from "@/lib/payroll-workbook-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/payroll/export?kind=site|office&period=2026-11-13_2026-11-20 — the payroll Excel workbook of one pay period: every
 * approved / paid run of that period (site: each project crew + Drivers; office: Office, Engineers, Architects). Same people who
 * see the Payroll page's admin view (Owner, Accounting, PM, payroll helpers). Audited.
 */
export const GET = handleApi(async (req: NextRequest) => {
  const user = await requireUser();
  if (!(["OWNER", "ACCOUNTING", "PM"].includes(user.role) || user.payrollAssist)) throw new ApiError(403, "Only the Owner, Accounting, the PM and payroll staff can download payroll");
  const kind = req.nextUrl.searchParams.get("kind");
  const period = req.nextUrl.searchParams.get("period") ?? "";
  if (!isPayrollFileKind(kind)) throw new ApiError(400, "Choose the site & drivers or the office payroll");
  if (!/^\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}$/.test(period)) throw new ApiError(400, "Choose a pay period");

  const loaded = await loadPayrollWorkbook(prisma, kind, period, user.name);
  if (!loaded) throw new ApiError(404, "No approved payroll run for that period yet");
  const buf = await buildPayrollWorkbook(loaded.input);

  await audit({
    entityType: "PayrollRun",
    entityId: loaded.runIds[0],
    actorId: user.id,
    actorName: user.name,
    action: "PAYROLL_WORKBOOK_EXPORTED",
    diff: { kind, period, runs: loaded.input.runs.map((r) => r.name) } as never,
  });

  const file = payrollFileName(kind, period);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${file.replace(/[^\w .&-]/g, "")}"`,
      "Cache-Control": "no-store",
    },
  });
});
