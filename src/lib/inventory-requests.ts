import type { MovementType, Prisma, ToolMovementType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/rbac";
export { REQUEST_LABEL, decisionText } from "@/lib/inventory-labels";

/**
 * Returns and transfers are REQUESTS: the person on site (foreman, driver, timekeeper, leadman, office staff…) asks, nothing
 * moves, and office staff approve it — only then do the warehouse and project balances (or the tool's location) change. The
 * names of the requester and of whoever decided are kept and shown. Everything else (issuing to a site, usage, supplier
 * deliveries, checking a tool out, repair/lost flags) is applied at once, as before. The Owner's own requests are approved on
 * the spot (the Owner is the approver).
 */
export const MATERIAL_REQUEST_TYPES: readonly MovementType[] = ["SITE_TO_WAREHOUSE", "SITE_TO_SITE"];
export const TOOL_REQUEST_TYPES: readonly ToolMovementType[] = ["RETURN_TO_WAREHOUSE", "TRANSFER_SITE_TO_SITE"];

export const materialNeedsApproval = (type: MovementType) => MATERIAL_REQUEST_TYPES.includes(type);
export const toolNeedsApproval = (type: ToolMovementType) => TOOL_REQUEST_TYPES.includes(type);

/** Which side of a materials movement is a project's on-site stock, and how the company warehouse balance is affected. */
export const MATERIAL_RULES: Record<MovementType, { needsFromProject: boolean; needsToProject: boolean; warehouseDelta: 1 | -1 | 0 }> = {
  SITE_TO_WAREHOUSE: { needsFromProject: true, needsToProject: false, warehouseDelta: 1 },
  WAREHOUSE_TO_SITE: { needsFromProject: false, needsToProject: true, warehouseDelta: -1 },
  SITE_TO_SITE: { needsFromProject: true, needsToProject: true, warehouseDelta: 0 },
  CONSUMED_ON_SITE: { needsFromProject: true, needsToProject: false, warehouseDelta: 0 },
  SUPPLIER_TO_SITE: { needsFromProject: false, needsToProject: true, warehouseDelta: 0 },
  SUPPLIER_TO_WAREHOUSE: { needsFromProject: false, needsToProject: false, warehouseDelta: 1 },
};

export interface MaterialMove {
  itemId: string;
  type: MovementType;
  qty: number;
  fromProjectId: string | null;
  toProjectId: string | null;
}

/**
 * Throws if the stock isn't there. Material already promised to other pending requests doesn't count as available, so two
 * people can't both request the same pieces. `excludeMovementId` is the request being approved (it must not count against itself).
 */
export async function assertMaterialAvailable(m: MaterialMove, item: { name: string; unit: string; currentQty: unknown }, opts: { excludeMovementId?: string } = {}) {
  const rule = MATERIAL_RULES[m.type];
  if (rule.warehouseDelta === -1 && Number(item.currentQty) < m.qty) {
    throw new ApiError(400, `Insufficient warehouse stock: ${item.name} has ${Number(item.currentQty)} ${item.unit}`);
  }
  if (m.fromProjectId) {
    const [stock, pending, project] = await Promise.all([
      prisma.projectMaterialStock.findUnique({ where: { projectId_itemId: { projectId: m.fromProjectId, itemId: m.itemId } } }),
      prisma.inventoryMovement.aggregate({
        where: { itemId: m.itemId, fromProjectId: m.fromProjectId, status: "PENDING", ...(opts.excludeMovementId ? { id: { not: opts.excludeMovementId } } : {}) },
        _sum: { qty: true },
      }),
      prisma.project.findUnique({ where: { id: m.fromProjectId }, select: { name: true } }),
    ]);
    const onSite = Number(stock?.qty ?? 0);
    const reserved = Number(pending._sum.qty ?? 0);
    if (onSite - reserved < m.qty) {
      throw new ApiError(
        400,
        reserved > 0
          ? `Not enough on site: ${item.name} has ${onSite} ${item.unit} at ${project?.name}, and ${reserved} ${item.unit} of it is already in a pending request`
          : `Insufficient on-site stock: ${item.name} has ${onSite} ${item.unit} at ${project?.name}`
      );
    }
  }
}

/** Move the balances for one materials movement (warehouse and/or the projects' on-site stock). Call inside a transaction. */
export async function applyMaterialMove(db: Prisma.TransactionClient, m: MaterialMove) {
  const rule = MATERIAL_RULES[m.type];
  if (rule.warehouseDelta !== 0) {
    await db.warehouseItem.update({ where: { id: m.itemId }, data: { currentQty: { increment: rule.warehouseDelta * m.qty } } });
  }
  if (m.fromProjectId) {
    await db.projectMaterialStock.upsert({
      where: { projectId_itemId: { projectId: m.fromProjectId, itemId: m.itemId } },
      create: { projectId: m.fromProjectId, itemId: m.itemId, qty: -m.qty },
      update: { qty: { decrement: m.qty } },
    });
  }
  if (m.toProjectId) {
    await db.projectMaterialStock.upsert({
      where: { projectId_itemId: { projectId: m.toProjectId, itemId: m.itemId } },
      create: { projectId: m.toProjectId, itemId: m.itemId, qty: m.qty },
      update: { qty: { increment: m.qty } },
    });
  }
}
