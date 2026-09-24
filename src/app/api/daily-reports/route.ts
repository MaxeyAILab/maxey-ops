import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { savePhotos } from "@/lib/storage";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";

const deliverySchema = z.object({
  material: z.string().min(1).max(200),
  qty: z.string().max(50),
  supplier: z.string().max(200),
  condition: z.string().max(100),
});

const manpowerSchema = z.object({
  role: z.string().min(1).max(100),
  count: z.coerce.number().int().min(0),
});

const createSchema = z.object({
  projectId: z.string().min(1),
  reportDate: z.coerce.date(),
  weather: z.string().max(200).optional().or(z.literal("")),
  workingHours: z.string().max(100).optional().or(z.literal("")),
  workProgress: z.string().min(1).max(5000),
  deliveries: z.array(deliverySchema).max(30).optional().default([]),
  manpower: z.array(manpowerSchema).max(30).optional().default([]),
  equipment: z.string().max(2000).optional().or(z.literal("")),
  siteEvents: z.string().max(2000).optional().or(z.literal("")),
  issues: z.string().max(2000).optional().or(z.literal("")),
  safety: z.string().max(2000).optional().or(z.literal("")),
  weatherNotes: z.string().max(2000).optional().or(z.literal("")),
  plannedNextDay: z.string().max(2000).optional().or(z.literal("")),
  overallProgress: z.string().max(2000).optional().or(z.literal("")),
  photos: z.array(z.string()).max(6).optional(),
  visibleToClient: z.boolean().optional().default(true),
});

/**
 * POST /api/daily-reports — end-of-day site record (fuller than a
 * ProgressEntry): work by trade, deliveries, manpower/equipment, site
 * events, issues, safety, next-day plan. Report No. is auto-assigned,
 * sequential per project (e.g. "DCR-023").
 */
export const POST = handleApi(async (req: NextRequest) => {
  const user = await requireUser(["OWNER", "PM", "FOREMAN"]);
  const body = createSchema.parse(await req.json());

  const project = await prisma.project.findUnique({ where: { id: body.projectId } });
  if (!project) throw new ApiError(404, "Project not found");

  const seqCount = await prisma.dailyConstructionReport.count({ where: { projectId: body.projectId } });
  const reportNo = `DCR-${String(seqCount + 1).padStart(3, "0")}`;

  const photoUrls = await savePhotos(body.photos);
  const report = await prisma.dailyConstructionReport.create({
    data: {
      projectId: body.projectId,
      reportNo,
      reportDate: body.reportDate,
      weather: body.weather || null,
      workingHours: body.workingHours || null,
      workProgress: body.workProgress,
      deliveries: body.deliveries.length ? body.deliveries : undefined,
      manpower: body.manpower.length ? body.manpower : undefined,
      equipment: body.equipment || null,
      siteEvents: body.siteEvents || null,
      issues: body.issues || null,
      safety: body.safety || null,
      weatherNotes: body.weatherNotes || null,
      plannedNextDay: body.plannedNextDay || null,
      overallProgress: body.overallProgress || null,
      photos: photoUrls.length ? photoUrls : undefined,
      submittedById: user.id,
      visibleToClient: body.visibleToClient,
    },
  });

  await audit({
    entityType: "DailyConstructionReport",
    entityId: report.id,
    actorId: user.id,
    actorName: user.name,
    action: "DAILY_REPORT_POSTED",
    diff: { project: project.name, reportNo, reportDate: body.reportDate },
  });

  return NextResponse.json(report, { status: 201 });
});
