import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import { manilaTime } from "@/lib/time-rules";
import { isSundayKey, type SheetInput } from "@/lib/timesheet";
import { dayClosedByPayroll, saveSheetRow } from "@/lib/timesheet-db";
import { alertSundayDecided } from "@/lib/timesheet-notify";

const schema = z.object({
  projectId: z.string().min(1),
  /** the Sunday, e.g. "2026-11-08" */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  decision: z.enum(["approve", "reject"]),
  /** the lines to decide; leave out to decide every line of that Sunday that is waiting */
  userIds: z.array(z.string().min(1)).max(300).optional(),
});

/**
 * POST /api/timesheet/weekend — the Owner decides Sunday work recorded by someone else. Approving makes the line's clock records
 * (so it is paid like any day, the usual 8-hour day; overtime on it is approved with it, since he sees the hours here); rejecting
 * leaves it unpaid. Owner only — not the PM, not the staff sharing the payroll work. A Sunday inside an approved payroll is closed.
 */
export const POST = handleApi(async (req: NextRequest) => {
  const user = await requireUser(["OWNER"]);
  const body = schema.parse(await req.json());
  if (!isSundayKey(body.date)) throw new ApiError(400, "That day is not a Sunday — only Sunday work waits for approval");
  const project = await prisma.project.findUnique({ where: { id: body.projectId }, select: { id: true, name: true } });
  if (!project) throw new ApiError(404, "Project not found");
  if (await dayClosedByPayroll(prisma, project.id, body.date)) throw new ApiError(409, "Payroll for this project has already been approved for that day — its sheet is closed");

  const date = new Date(`${body.date}T00:00:00.000Z`);
  const entries = await prisma.timesheetEntry.findMany({
    where: { projectId: project.id, date, weekendStatus: body.decision === "approve" ? { in: ["PENDING", "REJECTED"] } : "PENDING", ...(body.userIds ? { userId: { in: body.userIds } } : {}) },
  });
  if (entries.length === 0) throw new ApiError(400, "No Sunday line is waiting for a decision");
  const users = await prisma.user.findMany({ where: { id: { in: entries.map((e) => e.userId) } }, select: { id: true, name: true } });
  const nameOf = new Map(users.map((u) => [u.id, u.name]));

  // a worker who clocked in on their own that Sunday is already counted — approving the sheet line on top would pay the day twice
  const dayStart = manilaTime(body.date, 0, 0);
  const selfClocked = new Set(
    (await prisma.attendance.findMany({ where: { projectId: project.id, userId: { in: entries.map((e) => e.userId) }, source: { not: "timekeeper" }, timeIn: { gte: dayStart, lt: new Date(dayStart.getTime() + 86_400_000) } }, select: { userId: true } })).map((a) => a.userId)
  );

  const done: string[] = [];
  const skipped: { userId: string; name: string; why: string }[] = [];
  for (const e of entries) {
    const name = nameOf.get(e.userId) ?? "—";
    if (body.decision === "reject") {
      const res = await prisma.timesheetEntry.updateMany({ where: { id: e.id, weekendStatus: "PENDING" }, data: { weekendStatus: "REJECTED", weekendDecidedById: user.id, weekendDecidedByName: user.name, weekendDecidedAt: new Date() } });
      if (res.count === 0) skipped.push({ userId: e.userId, name, why: "it was just changed — reload the sheet" });
      else done.push(e.userId);
      continue;
    }
    if (selfClocked.has(e.userId)) {
      skipped.push({ userId: e.userId, name, why: "clocked in on their own that Sunday — their own clock-in counts" });
      continue;
    }
    const input: SheetInput = {
      amIn: e.amIn,
      amOut: e.amOut,
      pmIn: e.pmIn,
      pmOut: e.pmOut,
      otHours: e.otHours ? Number(e.otHours) : null,
      approvedBy: e.approvedBy,
      remarks: e.remarks,
      absent: e.absent,
    };
    try {
      // the Owner saving the line is the Owner approving it: the same save as always, now made by him, creates the clock records
      await prisma.$transaction((db) => saveSheetRow(db, { userId: e.userId, projectId: project.id, dayKey: body.date, input, actor: { id: user.id, name: user.name, role: user.role }, workerName: name, canChangeApproved: true }));
      done.push(e.userId);
    } catch (err) {
      skipped.push({ userId: e.userId, name, why: err instanceof ApiError ? err.message : "could not be approved" });
    }
  }

  if (done.length > 0) {
    await audit({
      entityType: "TimesheetEntry",
      entityId: entries[0].id,
      actorId: user.id,
      actorName: user.name,
      action: body.decision === "approve" ? "TIMESHEET_WEEKEND_APPROVED" : "TIMESHEET_WEEKEND_REJECTED",
      diff: { project: project.name, date: body.date, workers: done.map((id) => nameOf.get(id) ?? id), count: done.length } as never,
    });
    await alertSundayDecided({ projectId: project.id, projectName: project.name, dayKey: body.date, approved: body.decision === "approve", lines: done.length, recordedBy: entries.filter((e) => done.includes(e.userId)).map((e) => e.enteredById), actorId: user.id });
  }
  return NextResponse.json({ ok: skipped.length === 0, changed: done.length, skipped });
});
