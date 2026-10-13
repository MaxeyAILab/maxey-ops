import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { parseDates } from "@/lib/date-input";
import { manilaToday } from "@/lib/milestones";
import { buildTemplateMilestones, MILESTONE_TEMPLATES } from "@/lib/milestone-templates";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";

const schema = z.object({
  projectId: z.string().min(1),
  template: z.enum(["building", "civil"]),
  startDate: z.string().optional().nullable(),
});

/**
 * POST /api/milestones/template — Owner/PM start a project's schedule from a template. It only
 * creates FORECAST dates laid end to end from the start date; no baseline is set (that is the
 * Owner's approval, made separately). It only works on a project with no milestones yet, and
 * the project row is locked so two simultaneous clicks can't create the set twice.
 */
export const POST = handleApi(async (req: NextRequest) => {
  const user = await requireUser(["OWNER", "PM"]);
  const body = schema.parse(await req.json());

  const project = await prisma.project.findUnique({ where: { id: body.projectId }, select: { id: true, name: true, startDate: true } });
  if (!project) throw new ApiError(404, "Project not found");

  const { startDate } = parseDates(body, ["startDate"]);
  const start = startDate ?? project.startDate ?? new Date(manilaToday(new Date()) * 86_400_000);
  const steps = buildTemplateMilestones(body.template, start);

  await prisma.$transaction(async (db) => {
    await db.$queryRaw`SELECT id FROM "Project" WHERE id = ${project.id} FOR UPDATE`;
    const existing = await db.milestone.count({ where: { projectId: project.id } });
    if (existing > 0) throw new ApiError(409, "This project already has milestones — the template only starts an empty schedule");
    await db.milestone.createMany({
      data: steps.map((s, i) => ({
        projectId: project.id,
        title: s.title,
        sortOrder: i + 1,
        forecastStart: s.forecastStart,
        forecastFinish: s.forecastFinish,
        createdById: user.id,
      })),
    });
  });

  await audit({
    entityType: "Project",
    entityId: project.id,
    actorId: user.id,
    actorName: user.name,
    action: "MILESTONE_TEMPLATE_APPLIED",
    diff: { project: project.name, template: MILESTONE_TEMPLATES[body.template].label, milestones: steps.length, start: start.toISOString().slice(0, 10) },
  });
  return NextResponse.json({ ok: true, milestones: steps.length }, { status: 201 });
});
