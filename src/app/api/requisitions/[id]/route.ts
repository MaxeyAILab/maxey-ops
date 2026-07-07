import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("review"), // PM/office completes costing (Spec 6.2)
    estimatedCost: z.coerce.number().min(0),
  }),
  z.object({ action: z.literal("approve") }),
  z.object({
    action: z.literal("reject"),
    reason: z.string().min(1).max(1000),
  }),
]);

/**
 * PATCH /api/requisitions/[id] — workflow transitions.
 * Approvals are append-only records: approve/reject stamps who + when and is
 * never overwritten (Spec §4 conflict rule).
 */
export const PATCH = handleApi(
  async (req: NextRequest, { params }: { params: { id: string } }) => {
    const body = actionSchema.parse(await req.json());

    const requisition = await prisma.requisition.findUnique({
      where: { id: params.id },
      include: { project: true, submittedBy: true },
    });
    if (!requisition) throw new ApiError(404, "Requisition not found");

    if (body.action === "review") {
      const user = await requireUser(["PM", "OWNER", "ACCOUNTING"]);
      if (!["SUBMITTED", "UNDER_REVIEW"].includes(requisition.status)) {
        throw new ApiError(400, `Cannot cost a requisition in ${requisition.status} state`);
      }
      const updated = await prisma.requisition.update({
        where: { id: params.id },
        data: { status: "UNDER_REVIEW", estimatedCost: body.estimatedCost },
      });
      await audit({
        entityType: "Requisition",
        entityId: requisition.id,
        actorId: user.id,
        actorName: user.name,
        action: "REQUISITION_COSTED",
        diff: { estimatedCost: body.estimatedCost },
      });
      return NextResponse.json(updated);
    }

    // approve / reject — Owner only (Spec §3)
    const user = await requireUser(["OWNER"]);
    if (["APPROVED", "REJECTED", "PO_ISSUED", "DELIVERED"].includes(requisition.status)) {
      throw new ApiError(400, `Requisition already ${requisition.status}`);
    }

    if (body.action === "approve") {
      const updated = await prisma.requisition.update({
        where: { id: params.id },
        data: {
          status: "APPROVED",
          approvedById: user.id,
          approvedAt: new Date(),
        },
      });
      await audit({
        entityType: "Requisition",
        entityId: requisition.id,
        actorId: user.id,
        actorName: user.name,
        action: "REQUISITION_APPROVED",
        diff: { estimatedCost: requisition.estimatedCost?.toString() ?? null },
      });
      // Auto-forward to Purchasing (Spec 6.2) — cost now committed vs budget
      await notify({
        to: { name: "Purchasing" },
        subject: "Requisition approved — create PO",
        message: `${requisition.project.name}: requisition from ${requisition.submittedBy.name} approved.`,
      });
      return NextResponse.json(updated);
    }

    const updated = await prisma.requisition.update({
      where: { id: params.id },
      data: { status: "REJECTED", rejectedReason: body.reason },
    });
    await audit({
      entityType: "Requisition",
      entityId: requisition.id,
      actorId: user.id,
      actorName: user.name,
      action: "REQUISITION_REJECTED",
      diff: { reason: body.reason },
    });
    await notify({
      to: { name: requisition.submittedBy.name },
      subject: "Requisition rejected",
      message: body.reason,
    });
    return NextResponse.json(updated);
  }
);
