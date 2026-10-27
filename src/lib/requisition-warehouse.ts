/**
 * Requisition items that come from the warehouse instead of a supplier. A line is linked to a warehouse item; when the Owner
 * approves the requisition the quantity is issued to the project automatically (a Warehouse → Site movement), so it is charged
 * to the project once — through the warehouse issue cost — and is left out of the requisition estimate and the purchase order.
 */

export interface StockOption {
  id: string;
  name: string;
  unit: string;
  warehouse: string;
  currentQty: number;
}

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9"'./x-]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0);

/**
 * Warehouse items that look like what was typed: every typed word has to appear in the item's name. Items with stock come
 * first (most in stock first), then the ones that are out of stock (so the requester sees "none left" instead of nothing).
 */
export function matchWarehouseStock<T extends StockOption>(typed: string, items: T[], limit = 6): T[] {
  const q = words(typed);
  if (q.join("").length < 2) return [];
  const hit = items.filter((i) => {
    const n = i.name.toLowerCase();
    return q.every((w) => n.includes(w));
  });
  hit.sort((a, b) => Number(b.currentQty > 0) - Number(a.currentQty > 0) || b.currentQty - a.currentQty || a.name.localeCompare(b.name));
  return hit.slice(0, limit);
}

/** How much of a request the warehouse can cover, and how much is left to buy. */
export function planWarehouseUse(requested: number, available: number): { fromWarehouse: number; toBuy: number } {
  const have = Math.max(0, Math.round(available * 100) / 100);
  const fromWarehouse = Math.min(requested, have);
  return { fromWarehouse, toBuy: Math.round((requested - fromWarehouse) * 100) / 100 };
}

export interface ReqLine {
  name: string;
  qty: unknown;
  unit: string;
  estUnitCost: unknown;
  warehouseItemId: string | null;
}

/** The estimate of a requisition: only the lines that are bought. Warehouse lines are charged when they are issued. */
export function purchaseEstimate(lines: ReqLine[]): number {
  return lines.filter((l) => !l.warehouseItemId).reduce((s, l) => s + Number(l.qty) * Number(l.estUnitCost ?? 0), 0);
}

export interface Shortfall {
  itemId: string;
  name: string;
  unit: string;
  warehouse: string;
  wanted: number;
  available: number;
}

/** Warehouse items the requisition asks for more of than the warehouse holds (lines for the same item add up). */
export function warehouseShortfalls(lines: { warehouseItemId: string | null; qty: unknown }[], stock: Map<string, StockOption>): Shortfall[] {
  const wanted = new Map<string, number>();
  for (const l of lines) if (l.warehouseItemId) wanted.set(l.warehouseItemId, (wanted.get(l.warehouseItemId) ?? 0) + Number(l.qty));
  const out: Shortfall[] = [];
  for (const [itemId, w] of wanted) {
    const s = stock.get(itemId);
    const available = s ? s.currentQty : 0;
    if (w > available + 1e-9) out.push({ itemId, name: s?.name ?? "(removed item)", unit: s?.unit ?? "", warehouse: s?.warehouse ?? "", wanted: w, available });
  }
  return out;
}
