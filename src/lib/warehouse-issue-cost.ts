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
}

export interface IssueCost {
  /** pesos charged to the project from the warehouse, net of returns */
  cost: number;
  /** issues / transfers / returns that have no price yet and are not in the figure */
  unpriced: number;
}

const cents = (n: number) => Math.round(n * 100) / 100;

export function issueCostByProject(rows: IssueRow[]): Map<string, IssueCost> {
  const out = new Map<string, IssueCost>();
  const at = (id: string) => {
    let c = out.get(id);
    if (!c) out.set(id, (c = { cost: 0, unpriced: 0 }));
    return c;
  };
  for (const r of rows) {
    if (r.status !== "APPLIED") continue;
    const value = lineValue(r.qty, r.unitPrice);
    const charge = (id: string | null, sign: 1 | -1) => {
      if (!id) return;
      const c = at(id);
      if (value === null) c.unpriced += 1;
      else c.cost = cents(c.cost + sign * value);
    };
    if (r.type === "WAREHOUSE_TO_SITE") charge(r.toProjectId, 1);
    else if (r.type === "SITE_TO_WAREHOUSE" && !r.excess) charge(r.fromProjectId, -1);
    else if (r.type === "SITE_TO_SITE") {
      charge(r.fromProjectId, -1);
      charge(r.toProjectId, 1);
    }
  }
  for (const c of out.values()) if (c.cost < 0) c.cost = 0;
  return out;
}

/** The warehouse cost of the given projects (all of them when no list is given), keyed by project id. */
export async function warehouseIssueCosts(projectIds?: string[]): Promise<Map<string, IssueCost>> {
  if (projectIds && projectIds.length === 0) return new Map();
  const rows = await prisma.inventoryMovement.findMany({
    where: {
      status: "APPLIED",
      type: { in: ["WAREHOUSE_TO_SITE", "SITE_TO_WAREHOUSE", "SITE_TO_SITE"] },
      ...(projectIds ? { OR: [{ fromProjectId: { in: projectIds } }, { toProjectId: { in: projectIds } }] } : {}),
    },
    select: { type: true, status: true, qty: true, unitPrice: true, fromProjectId: true, toProjectId: true, excess: true },
  });
  return issueCostByProject(rows);
}
