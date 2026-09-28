import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { notifyOwner } from "@/lib/notify";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import { isManilaSaturday, isManilaSunday, isWeekendRestrictedDepartment } from "@/lib/time-rules";

const createSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.enum(["EARLY_START", "OVERTIME"]),
    attendanceId: z.string().min(1),
    reason: z.string().min(1).max(1000),
  }),
  z.object({
    type: z.literal("WEEKEND_WORK"),
    userId: z.string().min(1).optional(), // defaults to the requester
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // Manila calendar date, e.g. "2026-09-19"
    reason: z.string().min(1).max(1000),
  }),
]);

const TYPE_LABEL: Record<string, string> = {
  EARLY_START: "early-start",
  OVERTIME: "overtime",
  WEEKEND_WORK: "weekend-work",
};

/**
 * POST /api/time-adjustments — a worker (or their supervisor, on their
 * behalf) requests credit for time the standard payroll clamp would
 * otherwise exclude: clocked in before the department's scheduled start,
 * clocked out past 5pm, or — for Office/Driver, who are otherwise locked out
 * — working at all on a Saturday past 5pm or on a Sunday. Pending until
 * Owner/PM decides (PATCH [id]).
 */
export const POST = handleApi(async (req: NextRequest) => {
  const user = await requireUser();
  if (user.role === "CLIENT") throw new ApiError(403, "Not authorized");
  const body = createSchema.parse(await req.json());
  const canRequestForOthers = ["OWNER", "PM", "FOREMAN"].includes(user.role);

  if (body.type === "WEEKEND_WORK") {
    const targetUserId = body.userId || user.id;
    if (targetUserId !== user.id && !canRequestForOthers) {
      throw new ApiError(403, "You can only request an adjustment for your own time");
    }
    const target = await prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target) throw new ApiError(404, "Employee not found");
    if (!isWeekendRestrictedDepartment(target.department)) {
      throw new ApiError(400, "Weekend-work requests only apply to Office/Driver accounts");
    }
    const date = new Date(`${body.date}T00:00:00.000Z`);
    if (!isManilaSaturday(date) && !isManilaSunday(date)) {
      throw new ApiError(400, "Pick a Saturday or Sunday");
    }

    const existing = await prisma.timeAdjustmentRequest.findUnique({
      where: { userId_date_type: { userId: targetUserId, date, type: "WEEKEND_WORK" } },
    });
    if (existing) throw new ApiError(400, "A weekend-work request already exists for that date");

    const request = await prisma.timeAdjustmentRequest.create({
      data: {
        userId: targetUserId,
        date,
        type: "WEEKEND_WORK",
        reason: body.reason,
        requestedById: user.id,
      },
    });

    await audit({
      entityType: "TimeAdjustmentRequest",
      entityId: request.id,
      actorId: user.id,
      actorName: user.name,
      action: "TIME_ADJUSTMENT_REQUESTED",
      diff: { employee: target.name, type: body.type, date: body.date, reason: body.reason },
    });
    await notifyOwner(
      `Weekend-work request — ${target.name}`,
      `${user.name} requested weekend-work approval for ${target.name} on ${body.date} — reason: ${body.reason}`
    );

    return NextResponse.json(request, { status: 201 });
  }

  const attendance = await prisma.attendance.findUnique({
    where: { id: body.attendanceId },
    include: { user: { select: { name: true } } },
  });
  if (!attendance) throw new ApiError(404, "Attendance record not found");

  if (attendance.userId !== user.id && !canRequestForOthers) {
    throw new ApiError(403, "You can only request an adjustment for your own time");
  }

  const existing = await prisma.timeAdjustmentRequest.findUnique({
    where: { attendanceId_type: { attendanceId: body.attendanceId, type: body.type } },
  });
  if (existing) {
    throw new ApiError(400, `A ${TYPE_LABEL[body.type]} request already exists for this entry`);
  }

  const request = await prisma.timeAdjustmentRequest.create({
    data: {
      attendanceId: body.attendanceId,
      userId: attendance.userId,
      type: body.type,
      reason: body.reason,
      requestedById: user.id,
    },
  });

  await audit({
    entityType: "TimeAdjustmentRequest",
    entityId: request.id,
    actorId: user.id,
    actorName: user.name,
    action: "TIME_ADJUSTMENT_REQUESTED",
    diff: { employee: attendance.user.name, type: body.type, reason: body.reason },
  });
  await notifyOwner(
    `${TYPE_LABEL[body.type]} request — ${attendance.user.name}`,
    `${user.name} requested ${TYPE_LABEL[body.type]} credit for ${attendance.user.name} — reason: ${body.reason}`
  );

  return NextResponse.json(request, { status: 201 });
});
