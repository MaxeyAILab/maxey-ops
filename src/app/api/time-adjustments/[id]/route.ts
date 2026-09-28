import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve") }),
  z.object({ action: z.literal("reject"), reason: z.string().min(1).max(1000) }),
]);

const TYPE_LABEL: Record<string, string> = {
  EARLY_START: "early-start",
  OVERTIME: "overtime",
};

/**
 * PATCH /api/time-adjustments/[id] — Owner/PM approves or rejects a worker's
 * early-start/overtime request. Only an APPROVED request lifts the clamp for
 * that shift in src/lib/payroll.ts; a rejection just leaves the clamp in
 * place — the underlying Attendance row is never touched either way.
 */
export const PATCH = handleApi(
  async (req: NextRequest, { params }: { params: { id: string } }) => {
    const user = await requireUser(["OWNER", "PM"]);
    const body = actionSchema.parse(await req.json());

    const request = await prisma.timeAdjustmentRequest.findUnique({
      where: { id: params.id },
      include: { user: { select: { name: true, email: true } } },
    });
    if (!request) throw new ApiError(404, "Request not found");
    if (request.status !== "PENDING") {
      throw new ApiError(400, `Already ${request.status.toLowerCase()}`);
    }
    if (request.requestedById === user.id) {
      throw new ApiError(403, "You can't decide on your own request");
    }

    const status = body.action === "approve" ? "APPROVED" : "REJECTED";
    const updated = await prisma.timeAdjustmentRequest.update({
      where: { id: params.id },
      data: {
        status,
        decidedById: user.id,
        decidedAt: new Date(),
        decisionNote: body.action === "reject" ? body.reason : null,
      },
    });

    await audit({
      entityType: "TimeAdjustmentRequest",
      entityId: request.id,
      actorId: user.id,
      actorName: user.name,
      action: `TIME_ADJUSTMENT_${status}`,
      diff: { employee: request.user.name, type: request.type },
    });
    await notify({
      to: { name: request.user.name, email: request.user.email },
      subject: `Your ${TYPE_LABEL[request.type]} request was ${status.toLowerCase()}`,
      message:
        body.action === "reject"
          ? body.reason
          : "Approved — the extra time now counts toward your payroll hours.",
    });

    return NextResponse.json(updated);
  }
);
