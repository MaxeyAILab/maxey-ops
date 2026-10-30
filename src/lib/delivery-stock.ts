import type { Prisma } from "@prisma/client";
import { applyMaterialMove } from "@/lib/inventory-requests";
import { WAREHOUSE_VALUES } from "@/lib/warehouses";
import {
  desiredStock,
  findExistingItem,
  guessCategory,
  planDeliveryStock,
  type CatalogueEntry,
  type PlanChecklistRow,
  type PlanPoLine,
  type StockAction,
} from "@/lib/delivery-stock-plan";

type Db = Prisma.TransactionClient;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Takes quantity off a project's on-site balance, never below what is there (a correction cannot make the site go negative). */
async function takeOffSite(db: Db, projectId: string, itemId: string, qty: number): Promise<number> {
  const row = await db.projectMaterialStock.findUnique({ where: { projectId_itemId: { projectId, itemId } } });
  const take = Math.min(Math.max(Number(row?.qty ?? 0), 0), qty);
  if (take > 0) await db.projectMaterialStock.update({ where: { projectId_itemId: { projectId, itemId } }, data: { qty: { decrement: take } } });
  return round2(take);
}

export interface DeliveryStockResult {
  added: { item: string; qty: number }[];
  changed: { item: string; from: number; to: number }[];
  removed: { item: string; qty: number }[];
  /** quantity a correction wanted to take off the site but could not, because that much was no longer there (already used or moved) */
  shortBy: { item: string; qty: number }[];
}

const nothing = (): DeliveryStockResult => ({ added: [], changed: [], removed: [], shortBy: [] });

/**
 * Brings the project's on-site materials in step with a delivery: every received line of a fully verified delivery is one
 * "Supplier → Site" movement at the PO price (so you can see where it came from), added to the project's on-site balance. Safe to
 * call as often as you like — it only does the difference between what the delivery received and what it already put on site, so
 * confirming, editing or re-syncing a delivery never counts the same materials twice. Costs are not touched: the delivery is
 * already charged to the project through the PO, and a Supplier → Site movement carries no cost of its own. Call inside the same
 * transaction that changed the delivery. Deliveries verified before this existed (stocksSite false) never add anything.
 */
export async function syncDeliveryStock(db: Db, deliveryId: string): Promise<DeliveryStockResult> {
  const result = nothing();
  const d = await db.delivery.findUnique({
    where: { id: deliveryId },
    include: { project: { select: { id: true, name: true } }, po: { select: { poNumber: true, supplier: true, items: true } } },
  });
  if (!d) return result;
  const verified = !d.needsConfirmation || !!d.confirmedAt;
  const enabled = d.stocksSite && verified && !!d.projectId && !!d.project;
  const poLines = (Array.isArray(d.po.items) ? d.po.items : []) as unknown as PlanPoLine[];
  const checklist = (Array.isArray(d.checklist) ? d.checklist : []) as unknown as PlanChecklistRow[];

  const existingRows = await db.inventoryMovement.findMany({
    where: { deliveryId: d.id, type: "SUPPLIER_TO_SITE" },
    select: { id: true, deliveryLine: true, qty: true, itemId: true, toProjectId: true, item: { select: { name: true } } },
  });
  const actions = planDeliveryStock(
    desiredStock(checklist, poLines, enabled),
    existingRows.map((m) => ({ id: m.id, deliveryLine: m.deliveryLine, qty: Number(m.qty) }))
  );
  if (actions.length === 0) return result;
  const projectId = d.projectId; // only needed to add a line, and a delivery that can add has one (enabled)
  const supplier = d.po.supplier?.trim();
  const when = d.confirmedAt ?? new Date();
  const rowById = new Map(existingRows.map((m) => [m.id, m]));

  // the catalogue is read once, only if a new line has to find its item
  let catalogue: CatalogueEntry[] | null = null;
  let onSite: CatalogueEntry[] | null = null;
  const loadItems = async () => {
    if (catalogue && onSite) return;
    if (!projectId) return;
    const [all, stocks] = await Promise.all([
      db.warehouseItem.findMany({ select: { id: true, name: true, unit: true, warehouse: true, createdAt: true } }),
      db.projectMaterialStock.findMany({ where: { projectId }, include: { item: { select: { id: true, name: true, unit: true, warehouse: true } } }, orderBy: { qty: "desc" } }),
    ]);
    const rank = (w: string) => (WAREHOUSE_VALUES as readonly string[]).indexOf(w);
    catalogue = all
      .sort((a, b) => rank(a.warehouse) - rank(b.warehouse) || a.createdAt.getTime() - b.createdAt.getTime())
      .map((i) => ({ id: i.id, name: i.name, unit: i.unit, warehouse: i.warehouse }));
    onSite = stocks.map((s) => ({ id: s.item.id, name: s.item.name, unit: s.item.unit, warehouse: s.item.warehouse }));
  };

  for (const a of actions as StockAction[]) {
    if (a.kind === "add") {
      if (!projectId || !d.project) continue;
      await loadItems();
      let item = findExistingItem(a.line, a.unit, onSite!, catalogue!);
      let created = false;
      if (!item) {
        const made = await db.warehouseItem.create({
          data: { name: a.line.trim(), unit: a.unit, category: guessCategory(a.line), warehouse: "MAIN", currentQty: 0, unitPrice: a.unitCost > 0 ? a.unitCost : null },
        });
        item = { id: made.id, name: made.name, unit: made.unit, warehouse: made.warehouse };
        catalogue!.push(item);
        created = true;
      }
      await db.inventoryMovement.create({
        data: {
          itemId: item.id,
          type: "SUPPLIER_TO_SITE",
          qty: a.qty,
          fromLoc: supplier ? `Supplier — ${supplier}` : "Supplier",
          toLoc: d.project.name,
          toProjectId: projectId,
          note: `Delivered · ${d.po.poNumber}`,
          unitPrice: a.unitCost > 0 ? a.unitCost : null,
          actorId: d.verifiedById,
          createdAt: when,
          status: "APPLIED",
          newItem: created,
          deliveryId: d.id,
          deliveryLine: a.line,
        },
      });
      await applyMaterialMove(db, { itemId: item.id, type: "SUPPLIER_TO_SITE", qty: a.qty, fromProjectId: null, toProjectId: projectId });
      result.added.push({ item: item.name, qty: a.qty });
    } else if (a.kind === "change") {
      const row = rowById.get(a.movementId)!;
      const diff = round2(a.to - a.from);
      if (diff > 0) await applyMaterialMove(db, { itemId: row.itemId, type: "SUPPLIER_TO_SITE", qty: diff, fromProjectId: null, toProjectId: row.toProjectId });
      else {
        const took = row.toProjectId ? await takeOffSite(db, row.toProjectId, row.itemId, -diff) : 0;
        if (took < -diff) result.shortBy.push({ item: row.item.name, qty: round2(-diff - took) });
      }
      await db.inventoryMovement.update({ where: { id: row.id }, data: { qty: a.to, note: `Delivered · ${d.po.poNumber} · corrected from ${a.from} to ${a.to}` } });
      result.changed.push({ item: row.item.name, from: a.from, to: a.to });
    } else {
      const row = rowById.get(a.movementId)!;
      const took = row.toProjectId ? await takeOffSite(db, row.toProjectId, row.itemId, a.qty) : 0;
      if (took < a.qty) result.shortBy.push({ item: row.item.name, qty: round2(a.qty - took) });
      await db.inventoryMovement.delete({ where: { id: row.id } });
      result.removed.push({ item: row.item.name, qty: a.qty });
    }
  }
  return result;
}

/** Takes back everything a delivery put on site (used before the delivery is deleted). */
export async function removeDeliveryStock(db: Db, deliveryId: string): Promise<DeliveryStockResult> {
  const result = nothing();
  const rows = await db.inventoryMovement.findMany({
    where: { deliveryId, type: "SUPPLIER_TO_SITE" },
    select: { id: true, qty: true, itemId: true, toProjectId: true, item: { select: { name: true } } },
  });
  for (const m of rows) {
    const qty = Number(m.qty);
    const took = m.toProjectId ? await takeOffSite(db, m.toProjectId, m.itemId, qty) : 0;
    if (took < qty) result.shortBy.push({ item: m.item.name, qty: round2(qty - took) });
    await db.inventoryMovement.delete({ where: { id: m.id } });
    result.removed.push({ item: m.item.name, qty });
  }
  return result;
}
