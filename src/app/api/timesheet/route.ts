import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { notifyOwner } from "@/lib/notify";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import { manilaDayKey } from "@/lib/time-rules";
import { canEditSheet, isNoLoginAccount, regularHours, validateSheetRow, type SheetInput } from "@/lib/timesheet";
import { dayClosedByPayroll, saveSheetRow } from "@/lib/timesheet-db";

const hm = z.string().max(5).nullish().or(z.literal(""));
const rowSchema = z.object({
  userId: z.string().min(1),
  amIn: hm,
  amOut: hm,
  pmIn: hm,
  pmOut: hm,
  otHours: z.coerce.number().min(0).max(24).nullish(),
  approvedBy: z.string().max(120).nullish().or(z.literal("")),
  remarks: z.string().max(300).nullish().or(z.literal("")),
  absent: z.boolean().optional(),
});

const schema = z.object({
  projectId: z.string().min(1),
  /** the Manila calendar day, e.g. "2026-11-03" */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rows: z.array(rowSchema).min(1).max(200),
});

const clean = (v: string | null | undefined) => (v ? v : null);

/**
 * POST /api/timesheet — save the timekeeper's sheet for one project and day (the Owner, the PM, or a timekeeper assigned to the
 * project). One line per worker with no login: AM and PM times, overtime after 5:00 PM, who approved it on site, remarks. Each line
 * is checked and saved on its own, so one mistake never loses the rest; the answer says which lines were saved.
 */
export const POST = handleApi(async (req: NextRequest) => {
  const user = await requireUser();
  const body = schema.parse(await req.json());
  const dayKey = body.date;
  if (new Date(`${dayKey}T00:00:00.000Z`).toISOString().slice(0, 10) !== dayKey) throw new ApiError(400, "That is not a valid date");

  const project = await prisma.project.findUnique({ where: { id: body.projectId }, select: { id: true, name: true } });
  if (!project) throw new ApiError(404, "Project not found");
  const mine = await prisma.projectAssignment.findFirst({ where: { projectId: project.id, userId: user.id, active: true }, select: { id: true } });
  const allowed = canEditSheet(user, { assignedToProject: !!mine, dayKey, todayKey: manilaDayKey(new Date()) });
  if (!allowed.ok) throw new ApiError(403, allowed.reason);

  if (await dayClosedByPayroll(prisma, project.id, dayKey)) {
    throw new ApiError(409, "Payroll for this project has already been approved for that day — the sheet for it is closed");
  }

  const roster = await prisma.projectAssignment.findMany({
    where: { projectId: project.id, active: true },
    select: { startDate: true, user: { select: { id: true, name: true, email: true, department: true, active: true } } },
  });
  const workers = new Map(roster.map((r) => [r.user.id, r.user]));
  const joined = new Map(roster.map((r) => [r.user.id, r.startDate.toISOString().slice(0, 10)]));

  const results: { userId: string; ok: boolean; error?: string; hours?: number; cleared?: boolean }[] = [];
  let overtimeRows = 0;
  for (const r of body.rows) {
    const worker = workers.get(r.userId);
    if (!worker || !worker.active) {
      results.push({ userId: r.userId, ok: false, error: "This person is not on the project's roster" });
      continue;
    }
    // project payroll counts a worker's days from the day they joined the project — recording an earlier day would never be paid
    if (dayKey < (joined.get(r.userId) ?? "")) {
      results.push({ userId: r.userId, ok: false, error: `${worker.name} joined this project on ${joined.get(r.userId)} — a day before that would not be paid. Ask the Owner to assign them from an earlier date (Attendance → Edit).` });
      continue;
    }
    if (!isNoLoginAccount(worker.email)) {
      results.push({ userId: r.userId, ok: false, error: `${worker.name} has a login of their own and clocks in themself` });
      continue;
    }
    const input: SheetInput = {
      amIn: clean(r.amIn),
      amOut: clean(r.amOut),
      pmIn: clean(r.pmIn),
      pmOut: clean(r.pmOut),
      otHours: r.otHours ?? null,
      approvedBy: clean(r.approvedBy),
      remarks: clean(r.remarks),
      absent: !!r.absent,
    };
    const problem = validateSheetRow(input);
    if (problem) {
      results.push({ userId: r.userId, ok: false, error: `${worker.name}: ${problem}` });
      continue;
    }
    try {
      const saved = await prisma.$transaction((db) => saveSheetRow(db, { userId: worker.id, projectId: project.id, dayKey, input, actor: { id: user.id, name: user.name, role: user.role }, workerName: worker.name }));
      results.push({ userId: r.userId, ok: true, hours: regularHours(dayKey, input, worker.department), cleared: saved.cleared });
      if ((input.otHours ?? 0) > 0 && user.role !== "OWNER") overtimeRows++; // the Owner recording overtime has approved it — no one to tell
      await audit({
        entityType: "TimesheetEntry",
        entityId: saved.entryId || worker.id,
        actorId: user.id,
        actorName: user.name,
        action: saved.cleared ? "TIMESHEET_ENTRY_CLEARED" : "TIMESHEET_ENTRY_SAVED",
        diff: { worker: worker.name, project: project.name, date: dayKey, am: input.amIn ? `${input.amIn}–${input.amOut}` : null, pm: input.pmIn ? `${input.pmIn}–${input.pmOut}` : null, overtimeHours: input.otHours ?? 0, approvedBy: input.approvedBy, absent: input.absent, remarks: input.remarks } as never,
      });
    } catch (e) {
      results.push({ userId: r.userId, ok: false, error: e instanceof ApiError ? e.message : "Could not save this line" });
    }
  }
  if (overtimeRows > 0) {
    await notifyOwner(`Overtime from the timekeeper sheet — ${project.name}`, `${user.name} recorded overtime for ${overtimeRows} worker${overtimeRows === 1 ? "" : "s"} on ${dayKey}. Approve the credited hours in the Attendance tab.`);
  }
  return NextResponse.json({ ok: results.every((x) => x.ok), saved: results.filter((x) => x.ok).length, results });
});
