import { Prisma } from "@prisma/client";
import { poFullyReceived, type AdjustLine, type ChecklistRow, type PoLine } from "@/lib/delivery-adjust";

type Db = Prisma.TransactionClient;

/** A delivery counts once it is fully verified: confirmed by the receiver (or recorded before confirmation existed). */
const verifiedOf = (poId: string) => ({ poId, OR: [{ needsConfirmation: false }, { confirmedAt: { not: null } }] });

/** The checklists of a PO's fully verified deliveries, oldest first — optionally only those recorded before a moment, or without one delivery. */
export async function verifiedChecklists(db: Db, poId: string, opts: { before?: Date; excludeId?: string } = {}): Promise<ChecklistRow[][]> {
  const rows = await db.delivery.findMany({
    where: { ...verifiedOf(poId), ...(opts.before ? { createdAt: { lt: opts.before } } : {}), ...(opts.excludeId ? { id: { not: opts.excludeId } } : {}) },
    orderBy: { createdAt: "asc" },
    select: { checklist: true },
  });
  return rows.map((r) => (Array.isArray(r.checklist) ? (r.checklist as unknown as ChecklistRow[]) : []));
}

/** What an accepted delivery changed — kept on the delivery so the change can be shown and, if needed, undone. */
export interface StoredAdjustment {
  poItemsBefore: PoLine[];
  poTotalBefore: number;
  poTotalAfter: number;
  lines: AdjustLine[];
  requisition: { items: { id: string; from: number; to: number }[]; estimatedBefore: number | null; estimatedAfter: number; unmatched: string[] };
}

/**
 * Brings the PO's (and its requisition's) status in line with its fully verified deliveries: Delivered once everything on the PO
 * has arrived across all of them (or the Owner accepted the latest one as complete), otherwise Partially delivered, and no
 * delivery means Open again. A cancelled PO is left as it is.
 */
export async function syncPoStatus(db: Db, poId: string): Promise<void> {
  const po = await db.purchaseOrder.findUnique({ where: { id: poId }, select: { status: true, requisitionId: true, items: true } });
  if (!po || po.status === "CANCELLED") return;
  // only fully verified deliveries count — one still waiting for the receiver's confirmation changes nothing yet. A PO can come on
  // several trucks: it is Delivered once everything on it has arrived counting all of them together, or when the Owner accepted
  // the latest delivery as complete.
  const latest = await db.delivery.findFirst({ where: verifiedOf(poId), orderBy: { createdAt: "desc" }, select: { acceptedAt: true } });
  const poItems = (Array.isArray(po.items) ? po.items : []) as unknown as PoLine[];
  const status = !latest ? "OPEN" : latest.acceptedAt || poFullyReceived(poItems, await verifiedChecklists(db, poId)) ? "DELIVERED" : "PARTIALLY_DELIVERED";
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
