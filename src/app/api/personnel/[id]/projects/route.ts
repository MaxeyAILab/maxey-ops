import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";

const schema = z.object({
  /** every project the person should be on now (an empty list = no project, "TBA") */
  projectIds: z.array(z.string().min(1)).max(30),
  /** the day they join the projects being added (YYYY-MM-DD); default today. Payroll counts their days from here. */
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/**
 * PUT /api/personnel/[id]/projects — Owner only. Sets which project rosters a person is on, from the Attendance tab: projects added
 * here put them on that roster from the date given (default today, at their own rate), projects left out take them off (nothing is deleted — the time
 * already logged and past payroll stay as they are). No project at all means "TBA". Their department and role are changed in
 * "Edit personnel" as before.
 */
export const PUT = handleApi(async (req: NextRequest, { params }: { params: { id: string } }) => {
  const user = await requireUser(["OWNER"]);
  const body = schema.parse(await req.json());
  const wanted = new Set(body.projectIds);

  const person = await prisma.user.findUnique({ where: { id: params.id }, select: { id: true, name: true, role: true, active: true, hourlyRate: true, dailyRate: true } });
  if (!person || person.role === "CLIENT") throw new ApiError(404, "Personnel not found");
  if (!person.active) throw new ApiError(400, "This person is deactivated — reactivate them first");

  const projects = await prisma.project.findMany({ where: { id: { in: [...wanted] } }, select: { id: true, name: true } });
  if (projects.length !== wanted.size) throw new ApiError(400, "One of the projects does not exist");
  const names = new Map(projects.map((p) => [p.id, p.name]));

  const existing = await prisma.projectAssignment.findMany({ where: { userId: person.id }, include: { project: { select: { name: true } } } });
  const toAdd = [...wanted].filter((id) => !existing.some((a) => a.projectId === id && a.active));
  const toRemove = existing.filter((a) => a.active && !wanted.has(a.projectId));

  const rate = person.hourlyRate !== null ? Number(person.hourlyRate) : person.dailyRate !== null ? Number(person.dailyRate) / 8 : null;
  if (toAdd.length > 0 && !(rate && rate > 0)) throw new ApiError(400, `Set ${person.name}'s daily rate first (Edit personnel) — the roster needs a rate`);

  const todayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
  const fromKey = body.startDate ?? todayKey;
  const today = new Date(`${fromKey}T00:00:00.000Z`);
  if (Number.isNaN(today.getTime()) || today.toISOString().slice(0, 10) !== fromKey) throw new ApiError(400, "That is not a valid start date");
  if (fromKey > todayKey) throw new ApiError(400, "The start date cannot be in the future");
  await prisma.$transaction(async (db) => {
    for (const a of toRemove) await db.projectAssignment.update({ where: { id: a.id }, data: { active: false } });
    for (const projectId of toAdd) {
      const was = existing.find((a) => a.projectId === projectId);
      if (was) await db.projectAssignment.update({ where: { id: was.id }, data: { active: true, startDate: today, hourlyRate: rate! } });
      else await db.projectAssignment.create({ data: { projectId, userId: person.id, startDate: today, hourlyRate: rate! } });
    }
  });

  if (toAdd.length === 0 && toRemove.length === 0) return NextResponse.json({ ok: true, unchanged: true });
  await audit({
    entityType: "User",
    entityId: person.id,
    actorId: user.id,
    actorName: user.name,
    action: "PERSONNEL_PROJECTS_CHANGED",
    diff: {
      name: person.name,
      added: toAdd.map((id) => names.get(id)),
      removed: toRemove.map((a) => a.project.name),
      now: [...wanted].map((id) => names.get(id)),
    } as never,
  });
  return NextResponse.json({ ok: true, added: toAdd.length, removed: toRemove.length });
});
