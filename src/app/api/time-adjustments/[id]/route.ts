import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import { claimedExtraHours, rulesetForDepartment } from "@/lib/time-rules";

const actionSchema = z.discriminatedUnion("action", [
  // hours: approve only this many extra hours (early start / overtime) instead of everything that was clocked
  z.object({ action: z.literal("approve"), hours: z.number().positive().max(16).optional() }),
  z.object({ action: z.literal("reject"), reason: z.string().min(1).max(1000) }),
  // change the number of hours credited on a request that was already approved (Owner only)
  z.object({ action: z.literal("edit_hours"), hours: z.number().positive().max(16), reason: z.string().trim().min(3).max(500) }),
]);

const TYPE_LABEL: Record<string, string> = {
  EARLY_START: "early-start",
  OVERTIME: "overtime",
  WEEKEND_WORK: "weekend-work",
};

const APPROVED_MESSAGE: Record<string, string> = {
  EARLY_START: "Approved — the extra time now counts toward your payroll hours.",
  OVERTIME: "Approved — the extra time now counts toward your payroll hours.",
  WEEKEND_WORK: "Approved — you're clear to clock in that day, and the hours will count.",
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * PATCH /api/time-adjustments/[id] — Owner/PM approves or rejects a worker's early-start/overtime request. Only an APPROVED
 * request lifts the clamp for that shift in src/lib/payroll.ts; a rejection just leaves the clamp in place — the underlying
 * Attendance row is never touched either way.
 *
 * Approving can credit only some of the extra time ("hours"): the shift then counts that many hours after 5:00 PM (overtime) or
 * before the scheduled start (early start), whatever the employee clocked — for the worker who claims overtime while waiting
 * around. Without "hours", all the clocked time counts, as before. The Owner can change the number later (edit_hours); the
 * clock-in/out record itself is never changed, and a payroll run already generated is a snapshot that this does not rewrite.
 */
export const PATCH = handleApi(
  async (req: NextRequest, { params }: { params: { id: string } }) => {
    const body = actionSchema.parse(await req.json());
    const user = await requireUser(body.action === "edit_hours" ? ["OWNER"] : ["OWNER", "PM"]);

    const request = await prisma.timeAdjustmentRequest.findUnique({
      where: { id: params.id },
      include: { user: { select: { name: true, email: true, department: true } }, attendance: true },
    });
    if (!request) throw new ApiError(404, "Request not found");

    // what is being claimed (early start / overtime only): the clocked time beyond the schedule
    const claimed =
      request.attendance && (request.type === "EARLY_START" || request.type === "OVERTIME")
        ? claimedExtraHours(request.type, request.attendance.timeIn, request.attendance.timeOut, rulesetForDepartment(request.user.department))
        : null;

    if (body.action === "edit_hours") {
      if (request.status !== "APPROVED") throw new ApiError(400, "Only an approved request can have its hours changed");
      if (claimed === null) throw new ApiError(400, "Hours can only be set on an early-start or overtime request");
      const hours = round2(Math.min(body.hours, claimed));
      if (hours <= 0) throw new ApiError(400, "Nothing was clocked beyond the schedule for this shift");
      const before = request.approvedHours === null ? claimed : Number(request.approvedHours);
      if (before === hours) return NextResponse.json({ ok: true, unchanged: true });
      await prisma.timeAdjustmentRequest.update({ where: { id: request.id }, data: { approvedHours: hours } });
      await audit({
        entityType: "TimeAdjustmentRequest",
        entityId: request.id,
        actorId: user.id,
        actorName: user.name,
        action: "TIME_ADJUSTMENT_HOURS_CHANGED",
        diff: { employee: request.user.name, type: request.type, claimed, hoursBefore: before, hoursNow: hours, reason: body.reason },
      });
      await notify({
        to: { name: request.user.name, email: request.user.email },
        subject: `Your ${TYPE_LABEL[request.type]} credit was changed to ${hours} hour${hours === 1 ? "" : "s"}`,
        message: body.reason,
      });
      return NextResponse.json({ ok: true, hours });
    }

    if (request.status !== "PENDING") {
      throw new ApiError(400, `Already ${request.status.toLowerCase()}`);
    }
    if (request.requestedById === user.id) {
      throw new ApiError(403, "You can't decide on your own request");
    }

    // approving some of the time only
    let hours: number | null = null;
    if (body.action === "approve" && body.hours !== undefined) {
      if (claimed === null) throw new ApiError(400, "Hours can only be set on an early-start or overtime request");
      if (claimed <= 0) throw new ApiError(400, "Nothing was clocked beyond the schedule for this shift — there are no extra hours to credit");
      hours = round2(Math.min(body.hours, claimed));
    }

    const status = body.action === "approve" ? "APPROVED" : "REJECTED";
    const updated = await prisma.timeAdjustmentRequest.update({
      where: { id: params.id },
      data: {
        status,
        decidedById: user.id,
        decidedAt: new Date(),
        decisionNote: body.action === "reject" ? body.reason : null,
        approvedHours: body.action === "approve" ? hours : null,
      },
    });

    const partial = hours !== null && claimed !== null && hours < claimed;
    await audit({
      entityType: "TimeAdjustmentRequest",
      entityId: request.id,
      actorId: user.id,
      actorName: user.name,
      action: `TIME_ADJUSTMENT_${status}`,
      diff: { employee: request.user.name, type: request.type, ...(claimed !== null ? { claimedHours: claimed } : {}), ...(body.action === "approve" && hours !== null ? { creditedHours: hours } : {}) },
    });
    await notify({
      to: { name: request.user.name, email: request.user.email },
      subject: `Your ${TYPE_LABEL[request.type]} request was ${status.toLowerCase()}${partial ? ` for ${hours} hour${hours === 1 ? "" : "s"}` : ""}`,
      message: body.action === "reject" ? body.reason : partial ? `Approved — ${hours} of the ${claimed} extra hours you clocked now count toward your payroll hours.` : APPROVED_MESSAGE[request.type],
    });

    return NextResponse.json(updated);
  }
);
