import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import { projectOrCategoryLabel } from "@/lib/requisitions";

const actionSchema = z.object({ action: z.literal("cancel") });

/**
 * PATCH /api/purchase-orders/[id] — Owner-only cancel, while there's still
 * something left to cancel (Spec §3). A fully DELIVERED PO is a closed,
 * historical record — nothing to cancel there.
 *
 * PurchaseOrder.requisitionId is unique — a requisition can only ever have
 * one PO row. So a clean cancel (nothing delivered yet) actually DELETES
 * the PO row and reverts the requisition to APPROVED, freeing it up for a
 * corrected PO to be issued. If deliveries already happened against it
 * (partial delivery), the PO row and its delivery history are kept —
 * that's real activity, not something a cancel should erase — the row is
 * just marked CANCELLED and the requisition can't be reissued against
 * (submit a fresh requisition for anything still needed). Either way, the
 * full detail (PO number, supplier, total, who cancelled it and when)
 * lives permanently in the audit log regardless of what happens to the row.
 */
export const PATCH = handleApi(
  async (req: NextRequest, { params }: { params: { id: string } }) => {
    const body = actionSchema.parse(await req.json());
    const user = await requireUser(["OWNER"]);

    const po = await prisma.purchaseOrder.findUnique({
      where: { id: params.id },
      include: {
        requisition: { include: { project: true, submittedBy: true } },
        deliveries: { select: { id: true } },
      },
    });
    if (!po) throw new ApiError(404, "Purchase order not found");
    if (po.status === "DELIVERED") throw new ApiError(400, "Cannot cancel a fully delivered PO");
    if (po.status === "CANCELLED") throw new ApiError(400, "Already cancelled");

    const hasDeliveries = po.deliveries.length > 0;

    if (hasDeliveries) {
      // Keep the row + its delivery history; just close it out.
      await prisma.purchaseOrder.update({ where: { id: params.id }, data: { status: "CANCELLED" } });
    } else {
      // Nothing delivered — safe to remove entirely and free the
      // requisition up for a fresh PO.
      await prisma.$transaction([
        prisma.purchaseOrder.delete({ where: { id: params.id } }),
        prisma.requisition.update({ where: { id: po.requisitionId }, data: { status: "APPROVED" } }),
      ]);
    }

    await audit({
      entityType: "PurchaseOrder",
      entityId: po.id,
      actorId: user.id,
      actorName: user.name,
      action: "PO_CANCELLED",
      diff: {
        poNumber: po.poNumber,
        previousStatus: po.status,
        totalCost: po.totalCost.toString(),
        supplier: po.supplier,
        hadDeliveries: hasDeliveries,
        project: projectOrCategoryLabel(po.requisition),
      },
    });
    await notify({
      to: { name: "Purchasing" },
      subject: `PO cancelled — ${po.poNumber}`,
      message: hasDeliveries
        ? `${projectOrCategoryLabel(po.requisition)}: ${po.poNumber} cancelled by ${user.name} (delivery history kept).`
        : `${projectOrCategoryLabel(po.requisition)}: ${po.poNumber} cancelled by ${user.name}. Requisition is back to Approved for a corrected PO.`,
    });

    return NextResponse.json({ ok: true, hadDeliveries: hasDeliveries });
  }
);
