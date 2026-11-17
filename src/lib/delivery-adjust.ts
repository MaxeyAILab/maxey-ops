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
  /**
   * How much of this item earlier fully verified deliveries of the same PO had already brought when this one was recorded (owner's
   * request 2026-11-17: a PO can arrive on several trucks). Missing on deliveries recorded before then — read as 0.
   */
  alreadyReceived?: number;
}

export interface PoLine {
  name: string;
  qty: number;
  unit: string;
  unitCost: number;
  /** issued from warehouse stock (at no cost on the PO): an acceptance never changes these — the stock was already issued */
  fromWarehouse?: boolean;
}

const cents = (n: number) => Math.round(n * 100) / 100;
const key = (s: string) => s.trim().toLowerCase();

/** What this delivery still had to bring of an item: the PO quantity less what earlier deliveries brought (never below 0). */
export const dueQty = (c: Pick<ChecklistRow, "orderedQty" | "alreadyReceived">): number => Math.max(0, cents(Number(c.orderedQty) - Number(c.alreadyReceived ?? 0)));

/**
 * One line per item that did not arrive as it should — less than was still to come, damaged or not as specified. An item that
 * earlier deliveries already brought in full is not short when this one brings 0 of it. Empty when everything tallies.
 */
export function discrepancyLines(checklist: ChecklistRow[]): string[] {
  return checklist
    .filter((c) => {
      const due = dueQty(c);
      return Number(c.receivedQty) < due || (!c.ok && (due > 0 || Number(c.receivedQty) > 0));
    })
    .map((c) => {
      const before = Number(c.alreadyReceived ?? 0);
      return before > 0
        ? `${c.item}: ordered ${c.orderedQty}, ${before} received before, received ${c.receivedQty} now${c.remarks ? ` — ${c.remarks}` : ""}`
        : `${c.item}: ordered ${c.orderedQty}, received ${c.receivedQty}${c.remarks ? ` — ${c.remarks}` : ""}`;
    });
}

/** A delivery is complete when everything tallied, or when the Owner accepted it as final with a reason. */
export const isDeliveryComplete = (d: { discrepancies: string | null; acceptedAt?: Date | string | null }): boolean => !d.discrepancies || !!d.acceptedAt;

/**
 * How much of each item the given (fully verified) deliveries brought in total, by item name. `goodOnly` leaves out rows marked
 * not in good order — used to decide whether the PO is complete; the Owner's acceptance counts everything that came.
 */
export function receivedByItem(checklists: ChecklistRow[][], goodOnly = false): Map<string, number> {
  const out = new Map<string, number>();
  for (const list of checklists) for (const c of list) if (!goodOnly || c.ok) out.set(key(c.item), cents((out.get(key(c.item)) ?? 0) + Number(c.receivedQty)));
  return out;
}

/** Before the next truck: per PO line, what earlier deliveries brought (in good order) and what is still to come. */
export function remainingOnPo(poItems: Pick<PoLine, "name" | "qty">[], checklists: ChecklistRow[][]): { name: string; ordered: number; alreadyReceived: number; due: number }[] {
  const got = receivedByItem(checklists, true);
  return poItems.map((p) => {
    const alreadyReceived = got.get(key(p.name)) ?? 0;
    return { name: p.name, ordered: Number(p.qty), alreadyReceived, due: Math.max(0, cents(Number(p.qty) - alreadyReceived)) };
  });
}

/** Every PO line has arrived in full, in good order, counting all its fully verified deliveries together. */
export function poFullyReceived(poItems: Pick<PoLine, "name" | "qty">[], checklists: ChecklistRow[][]): boolean {
  if (checklists.length === 0) return false;
  return remainingOnPo(poItems, checklists).every((l) => l.due <= 0);
}

/** All the PO's deliveries as one checklist (quantities added up per item) — what the Owner's acceptance sets the PO to. */
export function combinedChecklist(checklists: ChecklistRow[][]): ChecklistRow[] {
  const all = receivedByItem(checklists);
  const first = new Map<string, ChecklistRow>();
  for (const list of checklists) for (const c of list) if (!first.has(key(c.item))) first.set(key(c.item), c);
  return Array.from(first.entries()).map(([k, c]) => ({ item: c.item, orderedQty: Number(c.orderedQty), receivedQty: all.get(k) ?? 0, ok: true }));
}

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
    if (p.fromWarehouse || to === undefined || to === Number(p.qty)) return { ...p };
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
