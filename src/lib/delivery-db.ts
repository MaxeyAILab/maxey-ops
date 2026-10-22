import { Prisma } from "@prisma/client";
import { isDeliveryComplete, type AdjustLine, type PoLine } from "@/lib/delivery-adjust";

type Db = Prisma.TransactionClient;

/** What an accepted delivery changed — kept on the delivery so the change can be shown and, if needed, undone. */
export interface StoredAdjustment {
  poItemsBefore: PoLine[];
  poTotalBefore: number;
  poTotalAfter: number;
  lines: AdjustLine[];
  requisition: { items: { id: string; from: number; to: number }[]; estimatedBefore: number | null; estimatedAfter: number; unmatched: string[] };
}

/**
 * Brings the PO's (and its requisition's) status in line with the fully verified deliveries: the latest one decides — complete
 * (tallied, or accepted by the Owner) means Delivered, otherwise Partially delivered, and no delivery means Open again. A
 * cancelled PO is left as it is.
 */
export async function syncPoStatus(db: Db, poId: string): Promise<void> {
  const po = await db.purchaseOrder.findUnique({ where: { id: poId }, select: { status: true, requisitionId: true } });
  if (!po || po.status === "CANCELLED") return;
  // only fully verified deliveries count — one still waiting for the receiver's confirmation changes nothing yet
  const latest = await db.delivery.findFirst({
    where: { poId, OR: [{ needsConfirmation: false }, { confirmedAt: { not: null } }] },
    orderBy: { createdAt: "desc" },
    select: { discrepancies: true, acceptedAt: true },
  });
  const status = !latest ? "OPEN" : isDeliveryComplete(latest) ? "DELIVERED" : "PARTIALLY_DELIVERED";
  await db.purchaseOrder.update({ where: { id: poId }, data: { status } });
  if (status === "DELIVERED") await db.requisition.updateMany({ where: { id: po.requisitionId, status: "PO_ISSUED" }, data: { status: "DELIVERED" } });
  else await db.requisition.updateMany({ where: { id: po.requisitionId, status: "DELIVERED" }, data: { status: "PO_ISSUED" } });
}

/** Puts the PO and requisition back to what they were before the Owner accepted this delivery, and clears the acceptance. */
export async function revertAcceptance(db: Db, deliveryId: string): Promise<boolean> {
  const d = await db.delivery.findUnique({ where: { id: deliveryId }, include: { po: { select: { id: true, requisitionId: true } } } });
  if (!d || !d.acceptedAt) return false;
  const adj = d.adjustment as unknown as StoredAdjustment | null;
  if (adj) {
    await db.purchaseOrder.update({ where: { id: d.po.id }, data: { items: adj.poItemsBefore as never, totalCost: adj.poTotalBefore } });
    for (const i of adj.requisition.items) await db.requisitionItem.update({ where: { id: i.id }, data: { qty: i.from } });
    await db.requisition.update({ where: { id: d.po.requisitionId }, data: { estimatedCost: adj.requisition.estimatedBefore } });
  }
  await db.delivery.update({ where: { id: deliveryId }, data: { acceptedAt: null, acceptedById: null, acceptedByName: null, acceptedNote: null, adjustment: Prisma.DbNull } });
  return true;
}
