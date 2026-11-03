import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import { forcedTimeOut } from "@/lib/force-timeout";

const schema = z.object({
  attendanceId: z.string().min(1),
  /** the time the shift ends, Manila time on the day it started, e.g. "17:00" */
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Write the time like 17:00"),
});

/**
 * POST /api/attendance/force-timeout — Owner only. Closes a shift the person forgot to time out of (they appear "On duty" and cannot
 * clock in again until it is closed). The time-out is set on the day the shift started, at the time given (normally 5:00 PM — the
 * end of the day — when they did no overtime). Nothing before the time-in, nothing in the future. Hours past 5:00 PM only count
 * when overtime is approved, as for anyone. The person is told and the change is in the audit log.
 */
export const POST = handleApi(async (req: NextRequest) => {
  const user = await requireUser(["OWNER"]);
  const body = schema.parse(await req.json());

  const a = await prisma.attendance.findUnique({ where: { id: body.attendanceId }, include: { user: { select: { id: true, name: true, department: true } } } });
  if (!a) throw new ApiError(404, "Attendance record not found");
  if (a.timeOut) throw new ApiError(409, "This shift was already closed");

  const t = forcedTimeOut(a.timeIn, body.time, new Date());
  if (!t.ok) throw new ApiError(400, t.error);
  const out = t.at;

  const done = await prisma.attendance.updateMany({ where: { id: a.id, timeOut: null }, data: { timeOut: out, deviceOut: "Time-out set by the Owner", gpsOut: null } });
  if (done.count === 0) throw new ApiError(409, "This shift was just closed by someone else");

  // hours of a period whose payroll is already approved or paid are not in that payroll — say so
  const closedRun = await prisma.payrollRun.findFirst({
    where: {
      status: { in: ["APPROVED", "PAID"] },
      periodStart: { lte: a.timeIn },
      periodEnd: { gte: a.timeIn },
      OR: [{ projectId: a.projectId ?? undefined }, { department: a.user.department ?? undefined }],
    },
    select: { id: true },
  });

  await audit({
    entityType: "Attendance",
    entityId: a.id,
    actorId: user.id,
    actorName: user.name,
    action: "TIME_OUT_FORCED",
    diff: { employee: a.user.name, forgotToTimeOut: true, timeIn: a.timeIn.toISOString(), timeOut: out.toISOString(), payrollAlreadyApproved: !!closedRun } as never,
  });
  return NextResponse.json({ ok: true, timeOut: out.toISOString(), payrollAlreadyApproved: !!closedRun });
});
