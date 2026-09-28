import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { notifyOwner } from "@/lib/notify";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";

const createSchema = z.object({
  attendanceId: z.string().min(1),
  type: z.enum(["EARLY_START", "OVERTIME"]),
  reason: z.string().min(1).max(1000),
});

const TYPE_LABEL: Record<string, string> = {
  EARLY_START: "early-start",
  OVERTIME: "overtime",
};

/**
 * POST /api/time-adjustments — a worker (or their supervisor, on their
 * behalf) requests credit for time the standard payroll clamp would
 * otherwise exclude: clocked in before the department's scheduled start, or
 * clocked out past 5pm. Pending until Owner/PM decides (PATCH [id]).
 */
export const POST = handleApi(async (req: NextRequest) => {
  const user = await requireUser();
  if (user.role === "CLIENT") throw new ApiError(403, "Not authorized");
  const body = createSchema.parse(await req.json());

  const attendance = await prisma.attendance.findUnique({
    where: { id: body.attendanceId },
    include: { user: { select: { name: true } } },
  });
  if (!attendance) throw new ApiError(404, "Attendance record not found");

  const canRequestForOthers = ["OWNER", "PM", "FOREMAN"].includes(user.role);
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
