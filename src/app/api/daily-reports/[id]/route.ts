import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
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

const patchSchema = z.object({
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
  visibleToClient: z.boolean().optional().default(true),
});

/** PATCH /api/daily-reports/[id] — correct a report; the original submitter,
 * or Owner/PM. Report No., date submitted, and photos are left as-is. */
export const PATCH = handleApi(
  async (req: NextRequest, { params }: { params: { id: string } }) => {
    const user = await requireUser(["OWNER", "PM", "FOREMAN"]);
    const body = patchSchema.parse(await req.json());

    const report = await prisma.dailyConstructionReport.findUnique({
      where: { id: params.id },
      include: { project: { select: { name: true } } },
    });
    if (!report) throw new ApiError(404, "Daily report not found");

    const canEdit = ["OWNER", "PM"].includes(user.role) || report.submittedById === user.id;
    if (!canEdit) throw new ApiError(403, "Not authorized to edit this report");

    const updated = await prisma.dailyConstructionReport.update({
      where: { id: params.id },
      data: {
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
        visibleToClient: body.visibleToClient,
        editedById: user.id,
        editedAt: new Date(),
      },
    });

    await audit({
      entityType: "DailyConstructionReport",
      entityId: report.id,
      actorId: user.id,
      actorName: user.name,
      action: "DAILY_REPORT_EDITED",
      diff: { project: report.project.name, reportNo: report.reportNo },
    });

    return NextResponse.json(updated);
  }
);

/** DELETE /api/daily-reports/[id] — Owner-only cleanup for a mistaken report. */
export const DELETE = handleApi(
  async (_req: NextRequest, { params }: { params: { id: string } }) => {
    const user = await requireUser(["OWNER"]);

    const report = await prisma.dailyConstructionReport.findUnique({
      where: { id: params.id },
      include: { project: { select: { name: true } } },
    });
    if (!report) throw new ApiError(404, "Daily report not found");

    await prisma.dailyConstructionReport.delete({ where: { id: params.id } });

    await audit({
      entityType: "DailyConstructionReport",
      entityId: report.id,
      actorId: user.id,
      actorName: user.name,
      action: "DAILY_REPORT_DELETED",
      diff: { project: report.project.name, reportNo: report.reportNo },
    });

    return NextResponse.json({ ok: true });
  }
);
