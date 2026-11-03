import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";

const patchSchema = z.object({
  /** "2026-10-14", or null for "not started yet" */
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date").nullable(),
});

/**
 * PATCH /api/projects/[id]/start-date — Owner only. Sets or corrects the date the project started (or is planned to start). Stored
 * as a calendar date, the same way the date chosen when the project was created is. Recorded with the old and new date.
 */
export const PATCH = handleApi(async (req: NextRequest, { params }: { params: { id: string } }) => {
  const user = await requireUser(["OWNER"]);
  const body = patchSchema.parse(await req.json());

  const project = await prisma.project.findUnique({ where: { id: params.id }, select: { id: true, name: true, startDate: true, targetEndDate: true } });
  if (!project) throw new ApiError(404, "Project not found");

  const next = body.startDate === null ? null : new Date(`${body.startDate}T00:00:00.000Z`);
  // a date that does not exist (30 Feb) would roll over to another day — refuse it instead
  if (next && (Number.isNaN(next.getTime()) || next.toISOString().slice(0, 10) !== body.startDate)) throw new ApiError(400, "That is not a valid date");
  if (next && next.getUTCFullYear() < 2000) throw new ApiError(400, "Choose a date from the year 2000 on");
  if (next && project.targetEndDate && next.getTime() > project.targetEndDate.getTime()) {
    throw new ApiError(400, "The start date cannot be after the target finish date — change the target finish first");
  }

  const was = project.startDate ? project.startDate.toISOString().slice(0, 10) : null;
  if (was === body.startDate) return NextResponse.json({ ok: true, unchanged: true });

  await prisma.project.update({ where: { id: project.id }, data: { startDate: next } });
  await audit({
    entityType: "Project",
    entityId: project.id,
    actorId: user.id,
    actorName: user.name,
    action: "PROJECT_START_DATE_EDITED",
    diff: { project: project.name, from: was, to: body.startDate },
  });
  return NextResponse.json({ ok: true, from: was, to: body.startDate });
});
