import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import { fmtDate } from "@/lib/format";
import { buildDailyReportPdf } from "@/lib/daily-report-pdf";

/**
 * GET /api/daily-reports/[id]/pdf — the Daily Construction Report as a real
 * PDF. Staff can download any report; a client can only download a report
 * for their own project that's marked visible to them (same rule the portal
 * page itself uses).
 */
export const GET = handleApi(
  async (_req: NextRequest, { params }: { params: { id: string } }) => {
    const user = await requireUser(["OWNER", "PM", "FOREMAN", "CLIENT"]);

    const report = await prisma.dailyConstructionReport.findUnique({
      where: { id: params.id },
      include: {
        project: { select: { name: true, address: true, clientId: true } },
        submittedBy: { select: { name: true } },
      },
    });
    if (!report) throw new ApiError(404, "Daily report not found");

    if (user.role === "CLIENT") {
      if (!report.visibleToClient || report.project.clientId !== user.clientId) {
        throw new ApiError(403, "Not your project");
      }
    }

    const pdfBytes = await buildDailyReportPdf({
      projectLabel: report.project.name,
      location: report.project.address || report.project.name,
      reportDate: fmtDate(report.reportDate),
      weather: report.weather ?? "",
      workingHours: report.workingHours ?? "",
      preparedBy: report.submittedBy.name,
      reportNo: report.reportNo,
      workProgress: report.workProgress,
      deliveries: (report.deliveries as { material: string; qty: string; supplier: string; condition: string }[] | null) ?? [],
      manpower: (report.manpower as { role: string; count: number }[] | null) ?? [],
      equipment: report.equipment ?? "",
      siteEvents: report.siteEvents ?? "",
      issues: report.issues ?? "",
      safety: report.safety ?? "",
      weatherNotes: report.weatherNotes ?? "",
      plannedNextDay: report.plannedNextDay ?? "",
      overallProgress: report.overallProgress ?? "",
    });

    const filename = `${report.reportNo}-${report.reportDate.toISOString().slice(0, 10)}.pdf`;
    return new NextResponse(Buffer.from(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }
);
