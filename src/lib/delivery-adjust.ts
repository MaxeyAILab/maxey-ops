/**
 * Pure rules for correcting a delivery: what counts as a discrepancy, whether a delivery is complete (including when the Owner
 * accepted it with a reason), and how the PO and the requisition change when the Owner accepts a delivery that does not match
 * what was ordered. No database here — shared by the API, the Deliveries page and the tests.
 */

export interface ChecklistRow {
  item: string;
  orderedQty: number;
  receivedQty: number;
  ok: boolean;
  remarks?: string | null;
}

export interface PoLine {
  name: string;
  qty: number;
  unit: string;
  unitCost: number;
}

const cents = (n: number) => Math.round(n * 100) / 100;
const key = (s: string) => s.trim().toLowerCase();

/** One line per item that did not arrive as ordered — short, damaged or not as specified. Empty when everything tallies. */
export function discrepancyLines(checklist: ChecklistRow[]): string[] {
  return checklist
    .filter((c) => !c.ok || c.receivedQty < c.orderedQty)
    .map((c) => `${c.item}: ordered ${c.orderedQty}, received ${c.receivedQty}${c.remarks ? ` — ${c.remarks}` : ""}`);
}

/** A delivery is complete when everything tallied, or when the Owner accepted it as final with a reason. */
export const isDeliveryComplete = (d: { discrepancies: string | null; acceptedAt?: Date | string | null }): boolean => !d.discrepancies || !!d.acceptedAt;

export interface AdjustLine {
  item: string;
  unit: string;
  unitCost: number;
  /** quantity on the PO before */
  from: number;
  /** quantity delivered — what the PO is changed to */
  to: number;
  /** change in cost for this line (negative = the company commits less) */
  costChange: number;
}

export interface AdjustPlan {
  lines: AdjustLine[];
  /** the PO's items after the change (all of them, changed or not) */
  poItems: PoLine[];
  totalBefore: number;
  totalAfter: number;
  /** nothing differs — the PO already matches what was delivered */
  unchanged: boolean;
}

export const poTotal = (items: { qty: number; unitCost: number }[]): number => cents(items.reduce((s, i) => s + Number(i.qty) * Number(i.unitCost), 0));

/**
 * What the Owner's acceptance does to the PO: every item the delivery checked is set to the quantity actually delivered. Items the
 * delivery did not list are left alone. The cost follows (quantity × the PO's unit cost), and so does the project's committed
 * cost, which is read from the PO total.
 */
export function planAdjustment(poItems: PoLine[], checklist: ChecklistRow[]): AdjustPlan {
  const received = new Map(checklist.map((c) => [key(c.item), Number(c.receivedQty)]));
  const lines: AdjustLine[] = [];
  const next = poItems.map((p) => {
    const to = received.get(key(p.name));
    if (to === undefined || to === Number(p.qty)) return { ...p };
    lines.push({ item: p.name, unit: p.unit, unitCost: Number(p.unitCost), from: Number(p.qty), to, costChange: cents(cents(to * Number(p.unitCost)) - cents(Number(p.qty) * Number(p.unitCost))) });
    return { ...p, qty: to };
  });
  return { lines, poItems: next, totalBefore: poTotal(poItems), totalAfter: poTotal(next), unchanged: lines.length === 0 };
}

/** The requisition items with their quantities changed to match the adjusted PO (matched by item name). */
export function adjustRequisitionItems<T extends { id: string; name: string; qty: number; estUnitCost: number | null }>(
  reqItems: T[],
  lines: Pick<AdjustLine, "item" | "to">[]
): { items: { id: string; from: number; to: number }[]; estimatedAfter: number; unmatched: string[] } {
  const target = new Map(lines.map((l) => [key(l.item), l.to]));
  const used = new Set<string>();
  const items = reqItems.flatMap((r) => {
    const to = target.get(key(r.name));
    if (to === undefined) return [];
    used.add(key(r.name));
    return to === Number(r.qty) ? [] : [{ id: r.id, from: Number(r.qty), to }];
  });
  const newQty = new Map(items.map((i) => [i.id, i.to]));
  const estimatedAfter = cents(reqItems.reduce((s, r) => s + (newQty.get(r.id) ?? Number(r.qty)) * Number(r.estUnitCost ?? 0), 0));
  return { items, estimatedAfter, unmatched: lines.filter((l) => !used.has(key(l.item))).map((l) => l.item) };
}
