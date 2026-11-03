import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { notifyOwner } from "@/lib/notify";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import { manilaDayKey } from "@/lib/time-rules";
import { canEditSheet, validateNewWorker, workerRates } from "@/lib/timesheet";

const schema = z.object({
  projectId: z.string().min(1),
  name: z.string().trim().min(1).max(100),
  position: z.string().trim().min(1).max(100),
  dailyRate: z.coerce.number().positive().max(1_000_000).nullish(),
  hourlyRate: z.coerce.number().positive().max(1_000_000).nullish(),
  /** the day they start on the project (YYYY-MM-DD, default today) — payroll counts their days from here */
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/**
 * POST /api/timesheet/workers — add a worker who has no login to a project's timekeeper sheet: the Owner, the PM, or a timekeeper
 * assigned to the project. Creates the worker (a placeholder account that cannot be signed into) with their position and rates, and
 * puts them on the project's roster, so they appear on the sheet and are paid by the project's weekly payroll. The Owner is told,
 * and it is in the audit log; the Owner can change anything later in Edit personnel.
 */
export const POST = handleApi(async (req: NextRequest) => {
  const user = await requireUser();
  const body = schema.parse(await req.json());
  const todayKey = manilaDayKey(new Date());
  const startKey = body.startDate ?? todayKey;
  if (new Date(`${startKey}T00:00:00.000Z`).toISOString().slice(0, 10) !== startKey) throw new ApiError(400, "That is not a valid start date");

  const project = await prisma.project.findUnique({ where: { id: body.projectId }, select: { id: true, name: true } });
  if (!project) throw new ApiError(404, "Project not found");
  const mine = await prisma.projectAssignment.findFirst({ where: { projectId: project.id, userId: user.id, active: true }, select: { id: true } });
  // the same rule as saving the sheet: Owner/PM anywhere; a timekeeper on their own project, and not further back than they may record
  const allowed = canEditSheet(user, { assignedToProject: !!mine, dayKey: startKey, todayKey });
  if (!allowed.ok) throw new ApiError(403, allowed.reason);

  const problem = validateNewWorker({ name: body.name, position: body.position, dailyRate: body.dailyRate ?? null, hourlyRate: body.hourlyRate ?? null });
  if (problem) throw new ApiError(400, problem);
  const rates = workerRates({ dailyRate: body.dailyRate ?? null, hourlyRate: body.hourlyRate ?? null });
  if ("error" in rates) throw new ApiError(400, rates.error);

  const roster = await prisma.projectAssignment.findMany({ where: { projectId: project.id, active: true }, select: { user: { select: { name: true } } } });
  if (roster.some((r) => r.user.name.trim().toLowerCase() === body.name.trim().toLowerCase())) {
    throw new ApiError(400, `${body.name.trim()} is already on this project`);
  }

  const email = `${body.name.toLowerCase().replace(/[^a-z0-9]+/g, ".")}.${crypto.randomBytes(3).toString("hex")}@staff.maxeyconstruction.ph`;
  const passwordHash = await bcrypt.hash(crypto.randomBytes(12).toString("hex"), 10); // nobody knows it: this person never signs in
  const worker = await prisma.$transaction(async (db) => {
    const w = await db.user.create({
      data: {
        name: body.name.trim(),
        email,
        passwordHash,
        role: "OFFICE",
        jobRole: "SITE_WORKER",
        department: "SITE",
        position: body.position.trim(),
        dailyRate: rates.dailyRate,
        hourlyRate: rates.hourlyRate,
        mustChangePassword: false,
        useCustomMenus: true,
        customMenus: [],
      },
    });
    await db.projectAssignment.create({ data: { projectId: project.id, userId: w.id, startDate: new Date(`${startKey}T00:00:00.000Z`), hourlyRate: rates.hourlyRate } });
    return w;
  });

  await audit({
    entityType: "User",
    entityId: worker.id,
    actorId: user.id,
    actorName: user.name,
    action: "PERSONNEL_ADDED",
    diff: { name: worker.name, position: worker.position, department: "SITE", dailyRate: rates.dailyRate, hourlyRate: rates.hourlyRate, assignedProject: project.name, startDate: startKey, addedFrom: "timekeeper sheet" } as never,
  });
  if (user.role !== "OWNER") {
    await notifyOwner(`New worker on the timekeeper sheet — ${project.name}`, `${user.name} added ${worker.name} (${worker.position}) at ₱${rates.dailyRate}/day (₱${rates.hourlyRate}/hr), from ${startKey}. Check the rate in Attendance → Edit if needed.`);
  }
  return NextResponse.json({ ok: true, userId: worker.id, name: worker.name, dailyRate: rates.dailyRate, hourlyRate: rates.hourlyRate }, { status: 201 });
});
