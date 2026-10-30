import { prisma } from "@/lib/prisma";
import { lineValue } from "@/lib/warehouse-value";

/**
 * What a project (or a non-corporate job) has taken out of the warehouse, at the price each item had when it was logged. This is
 * a real cost of the job — the material came out of company stock — and it is added to the project's committed cost.
 *
 * Counted (applied movements only):
 *  - Warehouse → Site: charged to the project it went to;
 *  - Site → Warehouse (a return of what was issued): credited back to the project it came from, at the same price;
 *  - Site → Site (a transfer between projects): moves the value from the first project to the second.
 * Returns and transfers only move the part that CAME FROM THE WAREHOUSE, item by item: materials a project got from a supplier
 * (a delivery against a purchase order) were charged to it through that PO, so giving them back or passing them on must neither
 * credit the warehouse cost it never had nor charge the receiving project a second time for materials already paid for on the
 * first project's PO.
 * Not counted: usage on site (it was already charged when it was issued), direct supplier deliveries (their cost is the
 * requisition/PO), a return of "excess" that was never issued from the warehouse, and anything that is still a pending request.
 * A movement with no price yet is not in the figure — it is counted as "unpriced" so it can be priced later (the figure then
 * rises). A project's warehouse cost never goes below zero.
 */
export interface IssueRow {
  type: string;
  status: string;
  qty: unknown;
  unitPrice: unknown;
  fromProjectId: string | null;
  toProjectId: string | null;
  excess?: boolean;
  /** which item — returns and transfers are matched to what was issued of the same item */
  itemId?: string;
  /** when it was logged: the rows are processed oldest first so a return only gives back what had been issued by then */
  createdAt?: Date | string;
}

export interface IssueCost {
  /** pesos charged to the project from the warehouse, net of returns */
  cost: number;
  /** issues / transfers / returns that have no price yet and are not in the figure */
  unpriced: number;
}

const cents = (n: number) => Math.round(n * 100) / 100;
const qty2 = (n: number) => Math.round(n * 100) / 100;

export function issueCostByProject(rows: IssueRow[]): Map<string, IssueCost> {
  const out = new Map<string, IssueCost>();
  const at = (id: string) => {
    let c = out.get(id);
    if (!c) out.set(id, (c = { cost: 0, unpriced: 0 }));
    return c;
  };
  // how much of each item a project holds that came out of the warehouse (and has not gone back or on to another project)
  const fromWarehouse = new Map<string, number>();
  const held = (project: string, item: string | undefined) => `${project}|${item ?? ""}`;
  const ordered = rows.every((r) => r.createdAt) ? [...rows].sort((a, b) => new Date(a.createdAt!).getTime() - new Date(b.createdAt!).getTime()) : rows;

  for (const r of ordered) {
    if (r.status !== "APPLIED") continue;
    const charge = (id: string | null, sign: 1 | -1, q: number) => {
      if (!id || q <= 0) return;
      const value = lineValue(q, r.unitPrice);
      const c = at(id);
      if (value === null) c.unpriced += 1;
      else c.cost = cents(c.cost + sign * value);
    };
    const q = Number(r.qty);
    if (r.type === "WAREHOUSE_TO_SITE" && r.toProjectId) {
      const k = held(r.toProjectId, r.itemId);
      fromWarehouse.set(k, qty2((fromWarehouse.get(k) ?? 0) + q));
      charge(r.toProjectId, 1, q);
    } else if (r.type === "SITE_TO_WAREHOUSE" && !r.excess && r.fromProjectId) {
      const k = held(r.fromProjectId, r.itemId);
      const back = Math.min(q, fromWarehouse.get(k) ?? 0);
      fromWarehouse.set(k, qty2((fromWarehouse.get(k) ?? 0) - back));
      charge(r.fromProjectId, -1, back);
    } else if (r.type === "SITE_TO_SITE" && r.fromProjectId && r.toProjectId) {
      const from = held(r.fromProjectId, r.itemId);
      const moved = Math.min(q, fromWarehouse.get(from) ?? 0);
      fromWarehouse.set(from, qty2((fromWarehouse.get(from) ?? 0) - moved));
      const to = held(r.toProjectId, r.itemId);
      fromWarehouse.set(to, qty2((fromWarehouse.get(to) ?? 0) + moved));
      charge(r.fromProjectId, -1, moved);
      charge(r.toProjectId, 1, moved);
    }
  }
  for (const c of out.values()) if (c.cost < 0) c.cost = 0;
  return out;
}

/**
 * The warehouse cost of the given projects (all of them when no list is given), keyed by project id. A transfer or return is
 * matched to what was issued to the project it came from, so the history of every project connected to the ones asked for by a
 * transfer is read too (only the asked-for projects are in the answer).
 */
export async function warehouseIssueCosts(projectIds?: string[]): Promise<Map<string, IssueCost>> {
  if (projectIds && projectIds.length === 0) return new Map();
  const select = { id: true, type: true, status: true, qty: true, unitPrice: true, fromProjectId: true, toProjectId: true, excess: true, itemId: true, createdAt: true } as const;
  const types = ["WAREHOUSE_TO_SITE", "SITE_TO_WAREHOUSE", "SITE_TO_SITE"] as const;
  if (!projectIds) return issueCostByProject(await prisma.inventoryMovement.findMany({ where: { status: "APPLIED", type: { in: [...types] } }, select }));

  const known = new Set(projectIds);
  const byId = new Map<string, IssueRow>();
  let frontier = [...known];
  while (frontier.length > 0) {
    const batch = await prisma.inventoryMovement.findMany({
      where: { status: "APPLIED", type: { in: [...types] }, OR: [{ fromProjectId: { in: frontier } }, { toProjectId: { in: frontier } }] },
      select,
    });
    const next = new Set<string>();
    for (const r of batch) {
      byId.set(r.id, r);
      for (const p of [r.fromProjectId, r.toProjectId]) if (p && !known.has(p)) (known.add(p), next.add(p));
    }
    frontier = [...next];
  }
  const all = issueCostByProject([...byId.values()]);
  return new Map([...all].filter(([id]) => projectIds.includes(id)));
}
