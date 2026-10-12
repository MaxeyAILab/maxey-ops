import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { dayIndex, manilaToday } from "@/lib/milestones";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import { assertOrder, parseDates } from "@/lib/date-input";

const dateField = z.string().optional().nullable();

const patchSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("update"),
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(2000).optional().nullable(),
    forecastStart: dateField,
    forecastFinish: dateField,
    actualFinish: dateField,
    status: z.enum(["NOT_STARTED", "IN_PROGRESS", "COMPLETED", "BLOCKED"]).optional(),
    responsibleId: z.string().optional().nullable(),
    notes: z.string().max(2000).optional().nullable(),
    visibleToClient: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("revise_baseline"),
    baselineStart: dateField,
    baselineFinish: dateField,
    reason: z.string().trim().min(5, "Give a reason of at least 5 characters").max(500),
  }),
]);

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/**
 * PATCH /api/milestones/[id]
 *  - update: PM/Owner keep the forecast, actual finish, status, owner and
 *    notes current. Marking COMPLETED fills today's date if no actual finish
 *    is given; reopening clears the actual finish. The baseline is untouched.
 *  - revise_baseline: Owner only. Never overwrites history — each revision
 *    is stored with the reason, who and when; the milestone then points at
 *    the newest one.
 */
export const PATCH = handleApi(async (req: NextRequest, { params }: { params: { id: string } }) => {
  const body = patchSchema.parse(await req.json());
  const user = await requireUser(body.action === "revise_baseline" ? ["OWNER"] : ["OWNER", "PM"]);

  const m = await prisma.milestone.findUnique({ where: { id: params.id }, include: { project: { select: { name: true } } } });
  if (!m) throw new ApiError(404, "Milestone not found");

  if (body.action === "revise_baseline") {
    const d = parseDates(body, ["baselineStart", "baselineFinish"]);
    if (!d.baselineStart && !d.baselineFinish) throw new ApiError(400, "Enter a baseline start or finish date");
    assertOrder(d.baselineStart, d.baselineFinish, "Baseline");
    if (dayIndex(d.baselineStart) === dayIndex(m.baselineStart) && dayIndex(d.baselineFinish) === dayIndex(m.baselineFinish)) {
      throw new ApiError(400, "These are the same baseline dates — nothing to revise");
    }
    try {
      const updated = await prisma.$transaction(async (db) => {
        const last = await db.milestoneBaselineRevision.aggregate({ where: { milestoneId: m.id }, _max: { revision: true } });
        await db.milestoneBaselineRevision.create({
          data: {
            milestoneId: m.id,
            revision: (last._max.revision ?? 0) + 1,
            baselineStart: d.baselineStart,
            baselineFinish: d.baselineFinish,
            reason: body.reason,
            revisedById: user.id,
            revisedByName: user.name,
          },
        });
        return db.milestone.update({
          where: { id: m.id },
          data: { baselineStart: d.baselineStart, baselineFinish: d.baselineFinish },
        });
      });
      await audit({
        entityType: "Milestone",
        entityId: m.id,
        actorId: user.id,
        actorName: user.name,
        action: "MILESTONE_BASELINE_REVISED",
        diff: {
          project: m.project.name,
          title: m.title,
          from: { start: iso(m.baselineStart), finish: iso(m.baselineFinish) },
          to: { start: iso(d.baselineStart), finish: iso(d.baselineFinish) },
          reason: body.reason,
        },
      });
      return NextResponse.json(updated);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ApiError(409, "The baseline was just revised by someone else — refresh and try again");
      }
      throw err;
    }
  }

  // ----- update -----
  const dates = parseDates(body, ["forecastStart", "forecastFinish", "actualFinish"]);
  const has = (k: keyof typeof body) => body[k] !== undefined;

  const forecastStart = has("forecastStart") ? dates.forecastStart : m.forecastStart;
  const forecastFinish = has("forecastFinish") ? dates.forecastFinish : m.forecastFinish;
  assertOrder(forecastStart, forecastFinish, "Forecast");

  let status = body.status ?? m.status;
  let actualFinish = has("actualFinish") ? dates.actualFinish : m.actualFinish;
  if (body.actualFinish && !body.status && status !== "COMPLETED") status = "COMPLETED";
  if (status === "COMPLETED" && !actualFinish) actualFinish = new Date(manilaToday(new Date()) * 86_400_000);
  if (status !== "COMPLETED") actualFinish = null;

  if (body.responsibleId) {
    const staff = await prisma.user.findFirst({ where: { id: body.responsibleId, active: true, role: { not: "CLIENT" } } });
    if (!staff) throw new ApiError(400, "Responsible person must be an active staff member");
  }

  const updated = await prisma.milestone.update({
    where: { id: m.id },
    data: {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.description !== undefined ? { description: body.description || null } : {}),
      forecastStart,
      forecastFinish,
      actualFinish,
      status,
      ...(body.responsibleId !== undefined ? { responsibleId: body.responsibleId || null } : {}),
      ...(body.notes !== undefined ? { notes: body.notes || null } : {}),
      ...(body.visibleToClient !== undefined ? { visibleToClient: body.visibleToClient } : {}),
    },
  });

  await audit({
    entityType: "Milestone",
    entityId: m.id,
    actorId: user.id,
    actorName: user.name,
    action: status === "COMPLETED" && m.status !== "COMPLETED" ? "MILESTONE_COMPLETED" : "MILESTONE_UPDATED",
    diff: {
      project: m.project.name,
      title: m.title,
      from: { status: m.status, forecastStart: iso(m.forecastStart), forecastFinish: iso(m.forecastFinish), actualFinish: iso(m.actualFinish) },
      to: { status, forecastStart: iso(forecastStart), forecastFinish: iso(forecastFinish), actualFinish: iso(actualFinish) },
    },
  });

  return NextResponse.json(updated);
});

/** DELETE /api/milestones/[id] — Owner only; the audit entry keeps what was removed. */
export const DELETE = handleApi(async (_req: NextRequest, { params }: { params: { id: string } }) => {
  const user = await requireUser(["OWNER"]);
  const m = await prisma.milestone.findUnique({ where: { id: params.id }, include: { project: { select: { name: true } } } });
  if (!m) throw new ApiError(404, "Milestone not found");
  await prisma.milestone.delete({ where: { id: m.id } });
  await audit({
    entityType: "Milestone",
    entityId: m.id,
    actorId: user.id,
    actorName: user.name,
    action: "MILESTONE_DELETED",
    diff: { project: m.project.name, title: m.title, baselineFinish: iso(m.baselineFinish), status: m.status },
  });
  return NextResponse.json({ ok: true });
});
