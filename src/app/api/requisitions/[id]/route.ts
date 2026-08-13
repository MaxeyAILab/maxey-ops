import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import { projectOrCategoryLabel } from "@/lib/requisitions";

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("review"), // canvassing: per-item unit price + supplier remarks (Spec 6.2)
    items: z
      .array(
        z.object({
          id: z.string().min(1),
          unitCost: z.coerce.number().min(0),
          remarks: z.string().max(300).optional().or(z.literal("")),
        })
      )
      .min(1),
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
      include: { project: true, submittedBy: true, items: true },
    });
    if (!requisition) throw new ApiError(404, "Requisition not found");

    if (body.action === "review") {
      const user = await requireUser(["PM", "OWNER", "ACCOUNTING", "PURCHASING"]);
      if (!["SUBMITTED", "UNDER_REVIEW"].includes(requisition.status)) {
        throw new ApiError(400, `Cannot cost a requisition in ${requisition.status} state`);
      }
      const itemMap = new Map(requisition.items.map((i) => [i.id, i]));
      for (const it of body.items) {
        if (!itemMap.has(it.id)) throw new ApiError(400, "Unknown item on this requisition");
      }
      // Qty comes from the DB row, never the client — the total is only ever
      // as trustworthy as the quantity it's multiplied against.
      const estimatedCost = body.items.reduce(
        (sum, it) => sum + Number(itemMap.get(it.id)!.qty) * it.unitCost,
        0
      );

      const [updated] = await prisma.$transaction([
        prisma.requisition.update({
          where: { id: params.id },
          data: { status: "UNDER_REVIEW", estimatedCost },
        }),
        ...body.items.map((it) =>
          prisma.requisitionItem.update({
            where: { id: it.id },
            data: { estUnitCost: it.unitCost, remarks: it.remarks || null },
          })
        ),
      ]);
      await audit({
        entityType: "Requisition",
        entityId: requisition.id,
        actorId: user.id,
        actorName: user.name,
        action: "REQUISITION_COSTED",
        diff: {
          estimatedCost,
          items: body.items.map((it) => ({
            item: itemMap.get(it.id)!.name,
            unitCost: it.unitCost,
            remarks: it.remarks || null,
          })),
        },
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
        message: `${projectOrCategoryLabel(requisition)}: requisition from ${requisition.submittedBy.name} approved.`,
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

/**
 * DELETE /api/requisitions/[id] — Owner-only (Spec §3: destructive actions
 * stay with the Owner; every other role, present and future, never gets
 * this). Blocked once a Purchase Order exists — that's a committed
 * financial record, not something to silently erase.
 */
export const DELETE = handleApi(
  async (_req: NextRequest, { params }: { params: { id: string } }) => {
    const user = await requireUser(["OWNER"]);

    const requisition = await prisma.requisition.findUnique({
      where: { id: params.id },
      include: { project: true, submittedBy: true, purchaseOrder: true },
    });
    if (!requisition) throw new ApiError(404, "Requisition not found");
    if (requisition.purchaseOrder) {
      throw new ApiError(
        400,
        "Cannot delete — a purchase order already exists for this requisition."
      );
    }

    await audit({
      entityType: "Requisition",
      entityId: requisition.id,
      actorId: user.id,
      actorName: user.name,
      action: "REQUISITION_DELETED",
      diff: {
        project: projectOrCategoryLabel(requisition),
        submittedBy: requisition.submittedBy.name,
        status: requisition.status,
      },
    });
    await prisma.requisition.delete({ where: { id: params.id } });

    return NextResponse.json({ ok: true });
  }
);
