import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { parseDocumentDataUrl } from "@/lib/documents";
import { saveDocument } from "@/lib/storage";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import { canAddDocument } from "@/lib/project-input";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-04");

const createSchema = z.object({
  projectId: z.string().min(1),
  periodFrom: day,
  periodTo: day,
  title: z.string().trim().max(200).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
  dataUrl: z.string().min(1, "Choose the PDF file"),
  fileName: z.string().trim().max(200).optional().nullable(),
});

const asDate = (s: string) => new Date(`${s}T00:00:00.000Z`);

/**
 * POST /api/progress-reports — upload a progress report PDF for a reporting period.
 * The Owner, a PM, or anyone with "Project input" (e.g. the Project Engineer) may upload.
 */
export const POST = handleApi(async (req: NextRequest) => {
  const user = await requireUser();
  if (!canAddDocument(user)) throw new ApiError(403, "Only the Owner, a Project Manager or the Project Engineer uploads progress reports");
  const body = createSchema.parse(await req.json());

  const from = asDate(body.periodFrom);
  const to = asDate(body.periodTo);
  if (to < from) throw new ApiError(400, "The end of the reporting period is before its start");

  const parsed = parseDocumentDataUrl(body.dataUrl);
  if (!parsed.ok) throw new ApiError(400, parsed.error);
  if (parsed.mime !== "application/pdf") throw new ApiError(400, "Upload the progress report as a PDF");

  const project = await prisma.project.findUnique({ where: { id: body.projectId }, select: { id: true, name: true } });
  if (!project) throw new ApiError(404, "Project not found");

  const url = await saveDocument(body.dataUrl);
  const title = body.title || `${project.name} — Site Progress Report`;
  const report = await prisma.progressReportFile.create({
    data: {
      projectId: project.id,
      periodFrom: from,
      periodTo: to,
      title,
      url,
      fileName: body.fileName || null,
      notes: body.notes || null,
      uploadedById: user.id,
      uploadedByName: user.name,
    },
  });
  await audit({
    entityType: "ProgressReportFile",
    entityId: report.id,
    actorId: user.id,
    actorName: user.name,
    action: "PROGRESS_REPORT_UPLOADED",
    diff: { project: project.name, title, period: `${body.periodFrom} to ${body.periodTo}`, fileName: body.fileName ?? null },
  });
  return NextResponse.json({ id: report.id }, { status: 201 });
});
