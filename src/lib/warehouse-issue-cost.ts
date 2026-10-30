import { prisma } from "@/lib/prisma";
import { lineValue } from "@/lib/warehouse-value";

/**
 * What a project (or a non-corporate job) has taken out of the warehouse, and moved to or from other projects, at the prices
 * logged. A real cost of the job — the material was company stock, or was bought on another project's PO — added to the project's
 * committed cost (on top of its own POs, payroll and petty cash).
 *
 * Counted (applied movements only):
 *  - Warehouse → Site: charged to the project it went to;
 *  - Site → Warehouse (a return): credited to the project it came from, but only for the part that was charged to it through the
 *    warehouse (issued from it, or transferred in) — materials that arrived on the project's own PO are paid for by that PO, so
 *    sending them back does not credit warehouse cost it never had;
 *  - Site → Site (a transfer): the project that gives the materials away is credited, and the project that receives them is
 *    charged, for the number of items moved at what they cost where they were — whether they came from the warehouse or were
 *    bought on the first project's PO (a delivery). So the same materials are never counted on two projects: the first project's PO
 *    still shows what was bought, and the transfer takes the moved part off it again.
 * Each project's holding of an item is tracked oldest event first as three pools — charged through the warehouse, delivered on a PO,
 * and "no known cost" (materials logged by hand before deliveries were automatic) — and anything leaving takes from the pools in
 * proportion, at their average cost. Usage on site only shrinks the holding.
 * Not counted: usage on site (already charged), a return of "excess" never issued from the warehouse, anything still waiting for
 * approval or rejected. A movement with no price yet counts as "unpriced" so it can be priced later (the figure then rises).
 * The figure can be negative for a project that handed on more than it was charged through the warehouse — that is its PO being
 * taken off again, not an error.
 */
export interface IssueRow {
  type: string;
  status: string;
  qty: unknown;
  unitPrice: unknown;
  fromProjectId: string | null;
  toProjectId: string | null;
  excess?: boolean;
  /** which item — what leaves a project is matched to what it holds of the same item */
  itemId?: string;
  /** when it happened (when it was decided, for a request): rows are processed oldest first */
  createdAt?: Date | string;
  /** set when the material came from a verified PO delivery (its cost is the PO's), not entered by hand */
  deliveryId?: string | null;
}

export interface IssueCost {
  /** pesos charged to the project: from the warehouse and other projects, net of returns and of what it handed on */
  cost: number;
  /** issues / transfers / returns that have no price yet and are not in the figure */
  unpriced: number;
}

const cents = (n: number) => Math.round(n * 100) / 100;
const EPS = 1e-9;

interface Pools {
  /** charged to the project through the warehouse figure (issued from it, or transferred in) */
  whQ: number;
  whV: number;
  /** delivered on the project's own PO */
  poQ: number;
  poV: number;
  /** materials with no known cost (logged by hand) */
  zQ: number;
}
const empty = (): Pools => ({ whQ: 0, whV: 0, poQ: 0, poV: 0, zQ: 0 });

/** Takes `q` items out of a holding, in proportion to its pools; returns what was taken (never more than it holds). */
function take(h: Pools, q: number): Pools {
  const total = h.whQ + h.poQ + h.zQ;
  const t = Math.min(Math.max(q, 0), total);
  if (t <= EPS || total <= EPS) return empty();
  const r = t / total;
  const got: Pools = { whQ: h.whQ * r, whV: h.whV * r, poQ: h.poQ * r, poV: h.poV * r, zQ: h.zQ * r };
  h.whQ -= got.whQ;
  h.whV -= got.whV;
  h.poQ -= got.poQ;
  h.poV -= got.poV;
  h.zQ -= got.zQ;
  return got;
}

export function issueCostByProject(rows: IssueRow[]): Map<string, IssueCost> {
  const out = new Map<string, IssueCost>();
  const at = (id: string) => {
    let c = out.get(id);
    if (!c) out.set(id, (c = { cost: 0, unpriced: 0 }));
    return c;
  };
  const holdings = new Map<string, Pools>();
  const held = (project: string, item: string | undefined) => {
    const k = `${project}|${item ?? ""}`;
    let h = holdings.get(k);
    if (!h) holdings.set(k, (h = empty()));
    return h;
  };
  const ordered = rows.every((r) => r.createdAt) ? [...rows].sort((a, b) => new Date(a.createdAt!).getTime() - new Date(b.createdAt!).getTime()) : rows;

  for (const r of ordered) {
    if (r.status !== "APPLIED") continue;
    const q = Number(r.qty);
    if (!(q > 0)) continue;
    if (r.type === "WAREHOUSE_TO_SITE" && r.toProjectId) {
      const h = held(r.toProjectId, r.itemId);
      const value = lineValue(q, r.unitPrice);
      h.whQ += q;
      if (value === null) at(r.toProjectId).unpriced += 1;
      else {
        h.whV += value;
        at(r.toProjectId).cost = cents(at(r.toProjectId).cost + value);
      }
    } else if (r.type === "SUPPLIER_TO_SITE" && r.toProjectId) {
      const h = held(r.toProjectId, r.itemId);
      if (r.deliveryId) {
        h.poQ += q;
        h.poV += lineValue(q, r.unitPrice) ?? 0; // a delivery's cost is already on the PO — this only records what it cost per item
      } else h.zQ += q;
    } else if (r.type === "CONSUMED_ON_SITE" && r.fromProjectId) {
      take(held(r.fromProjectId, r.itemId), q);
    } else if (r.type === "SITE_TO_WAREHOUSE" && r.fromProjectId) {
      const t = take(held(r.fromProjectId, r.itemId), q);
      if (!r.excess && t.whV !== 0) at(r.fromProjectId).cost = cents(at(r.fromProjectId).cost - t.whV);
    } else if (r.type === "SITE_TO_SITE" && r.fromProjectId && r.toProjectId) {
      const t = take(held(r.fromProjectId, r.itemId), q);
      const value = t.whV + t.poV;
      if (Math.abs(value) > EPS) {
        at(r.fromProjectId).cost = cents(at(r.fromProjectId).cost - value);
        at(r.toProjectId).cost = cents(at(r.toProjectId).cost + value);
      }
      // what arrives is now charged to the receiving project, whichever pool it came from
      const to = held(r.toProjectId, r.itemId);
      to.whQ += t.whQ + t.poQ;
      to.whV += value;
      to.zQ += t.zQ;
    }
  }
  return out;
}

/**
 * The warehouse and transfer cost of the given projects (all of them when no list is given), keyed by project id. What a project
 * hands on or takes back is matched to what it was given, so the history of every project connected to the ones asked for by a
 * transfer is read too (only the asked-for projects are in the answer).
 */
export async function warehouseIssueCosts(projectIds?: string[]): Promise<Map<string, IssueCost>> {
  if (projectIds && projectIds.length === 0) return new Map();
  const select = { id: true, type: true, status: true, qty: true, unitPrice: true, fromProjectId: true, toProjectId: true, excess: true, itemId: true, createdAt: true, decidedAt: true, deliveryId: true } as const;
  const types = ["WAREHOUSE_TO_SITE", "SITE_TO_WAREHOUSE", "SITE_TO_SITE", "SUPPLIER_TO_SITE", "CONSUMED_ON_SITE"] as const;
  const asRow = (r: { createdAt: Date; decidedAt: Date | null } & Omit<IssueRow, "createdAt">): IssueRow => ({ ...r, createdAt: r.decidedAt ?? r.createdAt });
  if (!projectIds) return issueCostByProject((await prisma.inventoryMovement.findMany({ where: { status: "APPLIED", type: { in: [...types] } }, select })).map(asRow));

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
      byId.set(r.id, asRow(r));
      for (const p of [r.fromProjectId, r.toProjectId]) if (p && !known.has(p)) (known.add(p), next.add(p));
    }
    frontier = [...next];
  }
  const all = issueCostByProject([...byId.values()]);
  return new Map([...all].filter(([id]) => projectIds.includes(id)));
}
