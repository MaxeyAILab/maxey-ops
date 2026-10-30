import type { Prisma } from "@prisma/client";
import { ApiError } from "@/lib/rbac";
import { warehouseLabel } from "@/lib/warehouses";
import { applyMaterialMove } from "@/lib/inventory-requests";
import { OPEN_STATUSES, reservedByItem, type ReceiverRow, type TallyLine, movedQuantities } from "@/lib/tally-out";

type Db = Prisma.TransactionClient;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** TO-2026-0001, TO-2026-0002… (highest this year + 1, like purchase orders, so a deleted form never makes two share a number). */
export async function nextTallyNumber(db: Db): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `TO-${year}-`;
  const rows = await db.tallyOut.findMany({ where: { number: { startsWith: prefix } }, select: { number: true } });
  const top = rows.reduce((m, r) => Math.max(m, Number(r.number.slice(prefix.length)) || 0), 0);
  return `${prefix}${String(top + 1).padStart(4, "0")}`;
}

/**
 * Everything promised but not yet moved out of the warehouses: open tally-out forms, plus the warehouse lines of approved
 * requisitions that have not been issued yet (they are issued when the delivery is confirmed). Optionally leaves one form out.
 */
export async function reservedStock(db: Db, exceptTallyId?: string): Promise<Map<string, number>> {
  const [open, reqLines] = await Promise.all([
    db.tallyOut.findMany({ where: { status: { in: OPEN_STATUSES as never } }, select: { id: true, items: true } }),
    db.requisitionItem.findMany({
      where: { warehouseItemId: { not: null }, issuedMovementId: null, requisition: { status: { in: ["APPROVED", "PO_ISSUED"] } } },
      select: { warehouseItemId: true, qty: true },
    }),
  ]);
  const map = reservedByItem(open.map((t) => ({ id: t.id, items: (t.items as unknown as TallyLine[]) ?? [] })), exceptTallyId);
  for (const l of reqLines) map.set(l.warehouseItemId!, round2((map.get(l.warehouseItemId!) ?? 0) + Number(l.qty)));
  return map;
}

/** On-hand quantities of the given items, keyed by item id. */
export async function onHandOf(db: Db, itemIds: string[]): Promise<Map<string, number>> {
  const items = await db.warehouseItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, currentQty: true } });
  return new Map(items.map((i) => [i.id, Number(i.currentQty)]));
}

/**
 * The receiver confirmed: one Warehouse → Site movement per line for the quantity received, at the item's price now. The warehouse
 * balance goes down, the project's on-site balance goes up, and (as for any issue from the warehouse) the project is charged. Call
 * inside the transaction that marks the form DELIVERED. Throws if the warehouse no longer has that much.
 */
export async function issueTallyOut(db: Db, t: { id: string; number: string; projectId: string; requestedById: string; decidedById: string | null; decidedByName: string | null; items: TallyLine[] }, received: ReceiverRow[]): Promise<{ itemId: string; name: string; unit: string; qty: number; movementId: string }[]> {
  const moved = movedQuantities(received);
  const project = await db.project.findUnique({ where: { id: t.projectId }, select: { name: true } });
  const out: { itemId: string; name: string; unit: string; qty: number; movementId: string }[] = [];
  for (const line of t.items) {
    const qty = moved.get(line.itemId);
    if (!qty) continue;
    const item = await db.warehouseItem.findUnique({ where: { id: line.itemId } });
    if (!item) throw new ApiError(409, `${line.name} is no longer in the warehouse list`);
    if (Number(item.currentQty) + 1e-9 < qty) throw new ApiError(409, `The warehouse no longer has enough ${item.name}: ${Number(item.currentQty)} ${item.unit} left, ${qty} received`);
    const mv = await db.inventoryMovement.create({
      data: {
        clientUuid: crypto.randomUUID(),
        itemId: item.id,
        type: "WAREHOUSE_TO_SITE",
        qty,
        fromLoc: warehouseLabel(item.warehouse),
        toLoc: project?.name ?? "Project",
        toProjectId: t.projectId,
        note: `Tally-out ${t.number}`,
        unitPrice: item.unitPrice,
        actorId: t.requestedById,
        status: "APPLIED",
        decidedById: t.decidedById,
        decidedByName: t.decidedByName,
        decidedAt: new Date(),
        tallyOutId: t.id,
      },
    });
    await applyMaterialMove(db, { itemId: item.id, type: "WAREHOUSE_TO_SITE", qty, fromProjectId: null, toProjectId: t.projectId });
    out.push({ itemId: item.id, name: item.name, unit: item.unit, qty, movementId: mv.id });
  }
  return out;
}


