import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import { projectOrCategoryLabel } from "@/lib/requisitions";

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    // Canvassing (Spec 6.2): record one supplier's price for one item.
    // Several can be recorded per item — the first one recorded for an item
    // is auto-selected (so a single-supplier item needs no extra step), and
    // any of them can later be picked via select_quote.
    action: z.literal("add_quote"),
    itemId: z.string().min(1),
    supplier: z.string().min(1).max(200),
    unitCost: z.coerce.number().min(0),
    notes: z.string().max(300).optional().or(z.literal("")),
  }),
  z.object({
    // Pick which of an item's recorded quotes is the one to approve —
    // mirrors that quote's price/supplier onto the item so everything
    // downstream (PO creation, PDFs, dashboard rollups) keeps reading a
    // single estUnitCost/remarks pair, same as before quotes existed.
    action: z.literal("select_quote"),
    itemId: z.string().min(1),
    quoteId: z.string().min(1),
  }),
  z.object({ action: z.literal("approve") }),
  z.object({
    action: z.literal("reject"),
    reason: z.string().min(1).max(1000),
  }),
]);

/** Recompute the requisition total from each item's currently-selected
 * quote (estUnitCost), and move SUBMITTED -> UNDER_REVIEW the first time
 * anyone starts canvassing — same transition the old single-price flow made. */
async function refreshRequisitionAfterCosting(requisitionId: string, wasSubmitted: boolean) {
  const items = await prisma.requisitionItem.findMany({ where: { requisitionId } });
  const estimatedCost = items.reduce((sum, i) => sum + Number(i.qty) * Number(i.estUnitCost ?? 0), 0);
  await prisma.requisition.update({
    where: { id: requisitionId },
    data: { estimatedCost, ...(wasSubmitted ? { status: "UNDER_REVIEW" as const } : {}) },
  });
  return estimatedCost;
}

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

    if (body.action === "add_quote" || body.action === "select_quote") {
      const user = await requireUser(["PM", "OWNER", "ACCOUNTING", "PURCHASING"]);
      if (!["SUBMITTED", "UNDER_REVIEW"].includes(requisition.status)) {
        throw new ApiError(400, `Cannot cost a requisition in ${requisition.status} state`);
      }
      const item = requisition.items.find((i) => i.id === body.itemId);
      if (!item) throw new ApiError(400, "Unknown item on this requisition");
      const wasSubmitted = requisition.status === "SUBMITTED";

      if (body.action === "add_quote") {
        const quote = await prisma.itemQuote.create({
          data: {
            requisitionItemId: item.id,
            supplier: body.supplier,
            unitCost: body.unitCost,
            notes: body.notes || null,
            submittedById: user.id,
          },
        });
        // First quote recorded for an item is auto-selected — a
        // single-supplier item still costs in one step, not two.
        const autoSelected = !item.selectedQuoteId;
        if (autoSelected) {
          await prisma.requisitionItem.update({
            where: { id: item.id },
            data: { selectedQuoteId: quote.id, estUnitCost: quote.unitCost, remarks: quote.supplier },
          });
        }
        const estimatedCost = await refreshRequisitionAfterCosting(requisition.id, wasSubmitted);
        await audit({
          entityType: "Requisition",
          entityId: requisition.id,
          actorId: user.id,
          actorName: user.name,
          action: "REQUISITION_QUOTE_ADDED",
          diff: { item: item.name, supplier: body.supplier, unitCost: body.unitCost, autoSelected, estimatedCost },
        });
      } else {
        const quote = await prisma.itemQuote.findUnique({ where: { id: body.quoteId } });
        if (!quote || quote.requisitionItemId !== item.id) {
          throw new ApiError(400, "Unknown quote for this item");
        }
        await prisma.requisitionItem.update({
          where: { id: item.id },
          data: { selectedQuoteId: quote.id, estUnitCost: quote.unitCost, remarks: quote.supplier },
        });
        const estimatedCost = await refreshRequisitionAfterCosting(requisition.id, wasSubmitted);
        await audit({
          entityType: "Requisition",
          entityId: requisition.id,
          actorId: user.id,
          actorName: user.name,
          action: "REQUISITION_QUOTE_SELECTED",
          diff: { item: item.name, supplier: quote.supplier, unitCost: quote.unitCost.toString(), estimatedCost },
        });
      }

      const updated = await prisma.requisition.findUnique({ where: { id: requisition.id } });
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
 * this). Blocked while an active (non-cancelled) Purchase Order exists —
 * cancel it first (PATCH /api/purchase-orders/[id]). Also blocked if a
 * cancelled PO still has real delivery history against it — that's genuine
 * operational activity, not something a delete should erase.
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
      if (requisition.purchaseOrder.status !== "CANCELLED") {
        throw new ApiError(
          400,
          "Cannot delete — a purchase order already exists. Cancel it first."
        );
      }
      const deliveryCount = await prisma.delivery.count({
        where: { poId: requisition.purchaseOrder.id },
      });
      if (deliveryCount > 0) {
        throw new ApiError(
          400,
          "Cannot delete — delivery history is recorded against this requisition's (cancelled) purchase order."
        );
      }
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
        cancelledPo: requisition.purchaseOrder?.poNumber ?? null,
      },
    });
    await prisma.$transaction([
      ...(requisition.purchaseOrder
        ? [prisma.purchaseOrder.delete({ where: { id: requisition.purchaseOrder.id } })]
        : []),
      prisma.requisition.delete({ where: { id: params.id } }),
    ]);

    return NextResponse.json({ ok: true });
  }
);
