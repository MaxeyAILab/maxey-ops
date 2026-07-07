import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";

const MOVEMENT_TYPES = [
  "SITE_TO_WAREHOUSE",
  "WAREHOUSE_TO_SITE",
  "SITE_TO_SITE",
  "CONSUMED_ON_SITE",
  "SUPPLIER_TO_SITE",
  "SUPPLIER_TO_WAREHOUSE",
] as const;

const createSchema = z.object({
  clientUuid: z.string().uuid(),
  submittedAt: z.coerce.date(),
  itemId: z.string().min(1),
  type: z.enum(MOVEMENT_TYPES),
  qty: z.coerce.number().positive(),
  fromProjectId: z.string().optional().or(z.literal("")),
  toProjectId: z.string().optional().or(z.literal("")),
  note: z.string().max(300).optional().or(z.literal("")), // e.g. usage note: "poured column C4"
});

/**
 * Which side of a movement is a project's on-site stock, and how the
 * company warehouse balance is affected (Spec 6.4 + owner's per-project
 * on-site tracking, 2026-07-07). CONSUMED_ON_SITE never touches the
 * warehouse — the material already left it when originally issued.
 */
const RULES: Record<
  (typeof MOVEMENT_TYPES)[number],
  { needsFromProject: boolean; needsToProject: boolean; warehouseDelta: 1 | -1 | 0 }
> = {
  SITE_TO_WAREHOUSE: { needsFromProject: true, needsToProject: false, warehouseDelta: 1 },
  WAREHOUSE_TO_SITE: { needsFromProject: false, needsToProject: true, warehouseDelta: -1 },
  SITE_TO_SITE: { needsFromProject: true, needsToProject: true, warehouseDelta: 0 },
  CONSUMED_ON_SITE: { needsFromProject: true, needsToProject: false, warehouseDelta: 0 },
  SUPPLIER_TO_SITE: { needsFromProject: false, needsToProject: true, warehouseDelta: 0 },
  SUPPLIER_TO_WAREHOUSE: { needsFromProject: false, needsToProject: false, warehouseDelta: 1 },
};

/**
 * POST /api/inventory/movements — log a materials movement, offline-capable
 * (foreman logs transfers/usage from the phone). Updates the warehouse
 * balance and/or the affected project(s)' on-site balance atomically with
 * the movement record.
 */
export const POST = handleApi(async (req: NextRequest) => {
  // Drivers no longer log inventory (owner's rule; trip logs come in Phase 3)
  const user = await requireUser(["FOREMAN", "PM", "OWNER", "PURCHASING"]);
  const body = createSchema.parse(await req.json());

  const dup = await prisma.inventoryMovement.findUnique({
    where: { clientUuid: body.clientUuid },
  });
  if (dup) return NextResponse.json({ error: "Already synced", id: dup.id }, { status: 409 });

  const item = await prisma.warehouseItem.findUnique({ where: { id: body.itemId } });
  if (!item) throw new ApiError(404, "Warehouse item not found");

  const rule = RULES[body.type];
  const fromProjectId = body.fromProjectId || null;
  const toProjectId = body.toProjectId || null;
  if (rule.needsFromProject !== !!fromProjectId) {
    throw new ApiError(
      400,
      rule.needsFromProject ? "This movement requires a source project" : "This movement type has no source project"
    );
  }
  if (rule.needsToProject !== !!toProjectId) {
    throw new ApiError(
      400,
      rule.needsToProject ? "This movement requires a destination project" : "This movement type has no destination project"
    );
  }

  const [fromProject, toProject] = await Promise.all([
    fromProjectId ? prisma.project.findUnique({ where: { id: fromProjectId } }) : null,
    toProjectId ? prisma.project.findUnique({ where: { id: toProjectId } }) : null,
  ]);
  if (fromProjectId && !fromProject) throw new ApiError(400, "Unknown source project");
  if (toProjectId && !toProject) throw new ApiError(400, "Unknown destination project");

  if (rule.warehouseDelta === -1 && Number(item.currentQty) < body.qty) {
    throw new ApiError(
      400,
      `Insufficient warehouse stock: ${item.name} has ${Number(item.currentQty)} ${item.unit}`
    );
  }
  if (fromProjectId) {
    const stock = await prisma.projectMaterialStock.findUnique({
      where: { projectId_itemId: { projectId: fromProjectId, itemId: body.itemId } },
    });
    const onSite = Number(stock?.qty ?? 0);
    if (onSite < body.qty) {
      throw new ApiError(
        400,
        `Insufficient on-site stock: ${item.name} has ${onSite} ${item.unit} at ${fromProject!.name}`
      );
    }
  }

  const fromLoc = fromProject
    ? fromProject.name
    : body.type === "SUPPLIER_TO_WAREHOUSE" || body.type === "SUPPLIER_TO_SITE"
      ? "Supplier"
      : "Warehouse";
  const toLoc = toProject ? toProject.name : body.type === "CONSUMED_ON_SITE" ? "Used on site" : "Warehouse";

  const movement = await prisma.$transaction(async (db) => {
    const movement = await db.inventoryMovement.create({
      data: {
        clientUuid: body.clientUuid,
        itemId: body.itemId,
        type: body.type,
        qty: body.qty,
        fromLoc,
        toLoc,
        fromProjectId,
        toProjectId,
        actorId: user.id,
        createdAt: body.submittedAt,
      },
    });
    if (rule.warehouseDelta !== 0) {
      await db.warehouseItem.update({
        where: { id: body.itemId },
        data: { currentQty: { increment: rule.warehouseDelta * body.qty } },
      });
    }
    if (fromProjectId) {
      await db.projectMaterialStock.upsert({
        where: { projectId_itemId: { projectId: fromProjectId, itemId: body.itemId } },
        create: { projectId: fromProjectId, itemId: body.itemId, qty: -body.qty },
        update: { qty: { decrement: body.qty } },
      });
    }
    if (toProjectId) {
      await db.projectMaterialStock.upsert({
        where: { projectId_itemId: { projectId: toProjectId, itemId: body.itemId } },
        create: { projectId: toProjectId, itemId: body.itemId, qty: body.qty },
        update: { qty: { increment: body.qty } },
      });
    }
    return movement;
  });

  await audit({
    entityType: "InventoryMovement",
    entityId: movement.id,
    actorId: user.id,
    actorName: user.name,
    action: `STOCK_${body.type}`,
    diff: { item: item.name, qty: body.qty, from: fromLoc, to: toLoc, note: body.note || null },
  });

  return NextResponse.json(movement, { status: 201 });
});
