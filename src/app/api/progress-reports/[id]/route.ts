import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import { canAddDocument, isProjectManagerRole } from "@/lib/project-input";

/** DELETE /api/progress-reports/[id] — remove an uploaded progress report (the Owner/PM, or the person who uploaded it). */
export const DELETE = handleApi(async (_req: NextRequest, { params }: { params: { id: string } }) => {
  const user = await requireUser();
  if (!canAddDocument(user)) throw new ApiError(403, "Not authorized for this action");
  const report = await prisma.progressReportFile.findUnique({ where: { id: params.id }, include: { project: { select: { name: true } } } });
  if (!report) throw new ApiError(404, "Progress report not found");
  if (!isProjectManagerRole(user) && report.uploadedById !== user.id) {
    throw new ApiError(403, "Only the Owner, a Project Manager or the person who uploaded it can remove this report");
  }
  await prisma.progressReportFile.delete({ where: { id: report.id } });
  await audit({
    entityType: "ProgressReportFile",
    entityId: report.id,
    actorId: user.id,
    actorName: user.name,
    action: "PROGRESS_REPORT_REMOVED",
    diff: {
      project: report.project.name,
      title: report.title,
      period: `${report.periodFrom.toISOString().slice(0, 10)} to ${report.periodTo.toISOString().slice(0, 10)}`,
      url: report.url,
      uploadedBy: report.uploadedByName,
    },
  });
  return NextResponse.json({ ok: true });
});
