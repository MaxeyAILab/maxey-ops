import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { assertOrder, parseDates } from "@/lib/date-input";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";

const dateField = z.string().optional().nullable();

const createSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  baselineStart: dateField,
  baselineFinish: dateField,
  forecastStart: dateField,
  forecastFinish: dateField,
  responsibleId: z.string().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  visibleToClient: z.boolean().optional().default(true),
});

/**
 * POST /api/milestones — add a milestone. PM and Owner can add one with
 * forecast dates; the approved baseline can only be supplied by the Owner
 * (it starts the baseline history at revision 1). A PM-created milestone has
 * no baseline until the Owner sets it, and shows as "no baseline" meanwhile.
 */
export const POST = handleApi(async (req: NextRequest) => {
  const user = await requireUser(["OWNER", "PM"]);
  const body = createSchema.parse(await req.json());

  const project = await prisma.project.findUnique({ where: { id: body.projectId }, select: { id: true, name: true } });
  if (!project) throw new ApiError(404, "Project not found");

  const d = parseDates(body, ["baselineStart", "baselineFinish", "forecastStart", "forecastFinish"]);
  const hasBaseline = !!(d.baselineStart || d.baselineFinish);
  if (hasBaseline && user.role !== "OWNER") {
    throw new ApiError(403, "Only the Owner can set the approved baseline dates");
  }
  assertOrder(d.baselineStart, d.baselineFinish, "Baseline");
  assertOrder(d.forecastStart, d.forecastFinish, "Forecast");

  if (body.responsibleId) {
    const staff = await prisma.user.findFirst({ where: { id: body.responsibleId, active: true, role: { not: "CLIENT" } } });
    if (!staff) throw new ApiError(400, "Responsible person must be an active staff member");
  }

  const last = await prisma.milestone.aggregate({ where: { projectId: body.projectId }, _max: { sortOrder: true } });

  const milestone = await prisma.$transaction(async (db) => {
    const m = await db.milestone.create({
      data: {
        projectId: body.projectId,
        title: body.title,
        description: body.description || null,
        sortOrder: (last._max.sortOrder ?? 0) + 1,
        baselineStart: d.baselineStart,
        baselineFinish: d.baselineFinish,
        forecastStart: d.forecastStart ?? d.baselineStart,
        forecastFinish: d.forecastFinish ?? d.baselineFinish,
        responsibleId: body.responsibleId || null,
        notes: body.notes || null,
        visibleToClient: body.visibleToClient,
        createdById: user.id,
      },
    });
    if (hasBaseline) {
      await db.milestoneBaselineRevision.create({
        data: {
          milestoneId: m.id,
          revision: 1,
          baselineStart: d.baselineStart,
          baselineFinish: d.baselineFinish,
          reason: "Original baseline",
          revisedById: user.id,
          revisedByName: user.name,
        },
      });
    }
    return m;
  });

  await audit({
    entityType: "Milestone",
    entityId: milestone.id,
    actorId: user.id,
    actorName: user.name,
    action: "MILESTONE_CREATED",
    diff: { project: project.name, title: body.title, baselineFinish: body.baselineFinish ?? null, forecastFinish: body.forecastFinish ?? null },
  });

  return NextResponse.json(milestone, { status: 201 });
});
