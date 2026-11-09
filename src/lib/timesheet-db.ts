import type { Prisma } from "@prisma/client";
import { ApiError } from "@/lib/rbac";
import { manilaTime } from "@/lib/time-rules";
import { changesRecord, sheetShifts, sundayStatusOnSave, type SheetInput, type WeekendStatus } from "@/lib/timesheet";

type Db = Prisma.TransactionClient;

const SOURCE = "timekeeper";

/** True when a payroll run that is already approved or paid covers this project on this day — the day is closed. */
export async function dayClosedByPayroll(db: Db, projectId: string, dayKey: string): Promise<boolean> {
  const noon = manilaTime(dayKey, 12, 0);
  const run = await db.payrollRun.findFirst({
    where: { projectId, status: { in: ["APPROVED", "PAID"] }, periodStart: { lte: noon }, periodEnd: { gte: noon } },
    select: { id: true },
  });
  return !!run;
}

export interface SaveRowResult {
  entryId: string;
  /** true when nothing is left on the sheet for this worker and day (a cleared row) */
  cleared: boolean;
  /** Sunday lines only: APPROVED (Owner's own, or already approved), PENDING (waits for the Owner, no pay yet), REJECTED; null on other days */
  weekend?: WeekendStatus | null;
}

/**
 * Saves one worker's line of the sheet and keeps the worker's clock-in/out records in step with it: the AM and PM times become two
 * records (so payroll counts them exactly like any other time), the overtime opens the usual overtime request on the PM record for
 * the Owner or PM to approve, and clearing a half removes its record. Safe to repeat — it changes the same records. Call inside a
 * transaction.
 */
export async function saveSheetRow(
  db: Db,
  p: { userId: string; projectId: string; dayKey: string; input: SheetInput; actor: { id: string; name: string; role: string }; workerName: string; /** the Owner, PM and staff sharing the work may still change a line the engineer approved (it then needs reviewing again) */ canChangeApproved?: boolean }
): Promise<SaveRowResult> {
  const { userId, projectId, dayKey, input, actor } = p;
  const date = new Date(`${dayKey}T00:00:00.000Z`);
  const existing = await db.timesheetEntry.findUnique({ where: { userId_projectId_date: { userId, projectId, date } } });
  // What the foreman and engineer signed is what they saw: once the engineer approved a line the timekeeper cannot change it.
  const changed = existing ? changesRecord({ ...existing, otHours: existing.otHours ? Number(existing.otHours) : null }, input) : true;
  if (existing?.engineerApprovedAt && changed && !p.canChangeApproved) {
    throw new ApiError(409, `${p.workerName}'s line was already approved by ${existing.engineerApprovedByName ?? "the project engineer"} — ask the PM, the Owner or the office to change it`);
  }
  const { am, pm } = sheetShifts(dayKey, input);
  const ot = Math.max(0, input.otHours ?? 0);
  // Sunday work waits for the Owner: until he approves it the line makes no clock records, so nothing is paid for it.
  const weekend = sundayStatusOnSave({ dayKey, actorIsOwner: actor.role === "OWNER", existing: (existing?.weekendStatus as WeekendStatus | null) ?? null, changed });
  const hold = weekend === "PENDING" || weekend === "REJECTED";
  const amShift = hold ? null : am;
  const pmShift = hold ? null : pm;

  const upsertShift = async (id: string | null | undefined, shift: { in: Date; out: Date } | null): Promise<string | null> => {
    if (!shift) {
      if (id) await db.attendance.deleteMany({ where: { id } }); // a request attached to it goes with it (checked below)
      return null;
    }
    if (id && (await db.attendance.findUnique({ where: { id }, select: { id: true } }))) {
      await db.attendance.update({ where: { id }, data: { timeIn: shift.in, timeOut: shift.out, projectId } });
      return id;
    }
    const row = await db.attendance.create({
      data: { userId, projectId, timeIn: shift.in, timeOut: shift.out, deviceIn: "Timekeeper sheet", source: SOURCE },
    });
    return row.id;
  };

  // An overtime request that was already decided is not touched or thrown away by a later edit of the sheet.
  const pmRequest = existing?.pmAttendanceId
    ? await db.timeAdjustmentRequest.findUnique({ where: { attendanceId_type: { attendanceId: existing.pmAttendanceId, type: "OVERTIME" } } })
    : null;
  const wasOt = Number(existing?.otHours ?? 0);
  if (pmRequest && pmRequest.status !== "PENDING") {
    if (!pmShift || Math.abs(wasOt - ot) > 1e-9) {
      throw new ApiError(409, `The overtime for ${p.workerName} on this day was already ${pmRequest.status === "APPROVED" ? "approved" : "decided"} — ask the Owner or PM to change the credited hours instead`);
    }
  }

  const amId = await upsertShift(existing?.amAttendanceId, amShift);
  const pmId = await upsertShift(existing?.pmAttendanceId, pmShift);

  if (pmId && ot > 0) {
    const reason = `Timekeeper sheet — ${ot} h overtime on ${dayKey}, approved on site by ${input.approvedBy?.trim()}`;
    if (pmRequest) {
      if (pmRequest.status === "PENDING") await db.timeAdjustmentRequest.update({ where: { id: pmRequest.id }, data: { reason } });
    } else {
      // The Owner recording the overtime is the Owner approving it (nobody may decide their own request, and the Owner is the one who
      // decides). Anyone else's overtime waits for the Owner or PM, as before.
      const byOwner = actor.role === "OWNER";
      await db.timeAdjustmentRequest.create({
        data: {
          attendanceId: pmId,
          userId,
          type: "OVERTIME",
          reason,
          requestedById: actor.id,
          ...(byOwner ? { status: "APPROVED" as const, decidedById: actor.id, decidedAt: new Date(), decisionNote: "Recorded by the Owner on the timekeeper sheet", approvedHours: ot } : {}),
        },
      });
    }
  }
  // overtime taken off (or the PM shift cleared) while still waiting: the request goes away (deleting the shift already cascades it)
  if (pmRequest && pmRequest.status === "PENDING" && pmId && ot === 0) {
    await db.timeAdjustmentRequest.delete({ where: { id: pmRequest.id } });
  }

  const cleared = !input.absent && !am && !pm && !(input.remarks && input.remarks.trim());
  if (cleared) {
    if (existing) await db.timesheetEntry.delete({ where: { id: existing.id } });
    return { entryId: existing?.id ?? "", cleared: true, weekend: null };
  }

  const now = new Date();
  const weekendData =
    weekend === null
      ? { weekendStatus: null, weekendDecidedById: null, weekendDecidedByName: null, weekendDecidedAt: null }
      : weekend === "APPROVED"
        ? existing?.weekendStatus === "APPROVED" && actor.role !== "OWNER"
          ? {}
          : { weekendStatus: "APPROVED", weekendDecidedById: actor.id, weekendDecidedByName: actor.name, weekendDecidedAt: now }
        : weekend === "PENDING"
          ? { weekendStatus: "PENDING", weekendDecidedById: null, weekendDecidedByName: null, weekendDecidedAt: null }
          : {};

  const data = {
    amIn: am ? input.amIn : null,
    amOut: am ? input.amOut : null,
    pmIn: pm ? input.pmIn : null,
    pmOut: pm ? input.pmOut : null,
    otHours: ot > 0 ? ot : null,
    approvedBy: input.approvedBy?.trim() || null,
    remarks: input.remarks?.trim() || null,
    absent: input.absent,
    amAttendanceId: amId,
    pmAttendanceId: pmId,
    enteredById: actor.id,
    enteredByName: actor.name,
    ...weekendData,
    // a real change to the times, overtime or absence needs the foreman and the engineer to look at it again
    ...(changed ? { reviewedById: null, reviewedByName: null, reviewedAt: null, engineerApprovedById: null, engineerApprovedByName: null, engineerApprovedAt: null } : {}),
  };
  const entry = existing
    ? await db.timesheetEntry.update({ where: { id: existing.id }, data })
    : await db.timesheetEntry.create({ data: { userId, projectId, date, ...data } });
  return { entryId: entry.id, cleared: false, weekend };
}
