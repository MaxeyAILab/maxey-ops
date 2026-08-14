import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";

/**
 * DELETE /api/deliveries/[id] — Owner-only, for correcting test/mistaken
 * delivery verifications. Recomputes the PO's status from whatever delivery
 * events remain (or reopens it if none do), and reverts the requisition off
 * "DELIVERED" if this was the event that completed it.
 */
export const DELETE = handleApi(
  async (_req: NextRequest, { params }: { params: { id: string } }) => {
    const user = await requireUser(["OWNER"]);

    const delivery = await prisma.delivery.findUnique({
      where: { id: params.id },
      include: { po: true },
    });
    if (!delivery) throw new ApiError(404, "Delivery not found");

    await prisma.$transaction(async (db) => {
      await db.delivery.delete({ where: { id: delivery.id } });

      if (delivery.po.status !== "CANCELLED") {
        const remaining = await db.delivery.findMany({
          where: { poId: delivery.poId },
          orderBy: { createdAt: "desc" },
          take: 1,
        });
        const newStatus =
          remaining.length === 0 ? "OPEN" : remaining[0].discrepancies ? "PARTIALLY_DELIVERED" : "DELIVERED";

        await db.purchaseOrder.update({ where: { id: delivery.poId }, data: { status: newStatus } });

        if (newStatus !== "DELIVERED") {
          await db.requisition.updateMany({
            where: { id: delivery.po.requisitionId, status: "DELIVERED" },
            data: { status: "PO_ISSUED" },
          });
        }
      }
    });

    await audit({
      entityType: "Delivery",
      entityId: delivery.id,
      actorId: user.id,
      actorName: user.name,
      action: "DELIVERY_DELETED",
      diff: { po: delivery.po.poNumber },
    });

    return NextResponse.json({ ok: true });
  }
);
