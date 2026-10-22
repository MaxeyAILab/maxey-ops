import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import { canLogInventoryMovement } from "@/lib/access";
import { warehouseLabel } from "@/lib/warehouses";
import { MATERIAL_RULES, applyMaterialMove, assertMaterialAvailable, materialNeedsApproval } from "@/lib/inventory-requests";

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
 * POST /api/inventory/movements — log a materials movement, offline-capable (the foreman logs transfers/usage from the
 * phone). Issuing to a site, usage and supplier deliveries are applied at once. A RETURN to the warehouse and a TRANSFER to
 * another project are requests (status PENDING): nothing moves until office staff approve them (PATCH /[id]) — the
 * Owner's own requests are approved on the spot. Either way the movement records who logged it.
 */
export const POST = handleApi(async (req: NextRequest) => {
  const user = await requireUser();
  if (!canLogInventoryMovement(user)) throw new ApiError(403, "Not authorized for this action");
  const body = createSchema.parse(await req.json());

  const dup = await prisma.inventoryMovement.findUnique({
    where: { clientUuid: body.clientUuid },
  });
  if (dup) return NextResponse.json({ error: "Already synced", id: dup.id }, { status: 409 });

  const item = await prisma.warehouseItem.findUnique({ where: { id: body.itemId } });
  if (!item) throw new ApiError(404, "Warehouse item not found");

  const rule = MATERIAL_RULES[body.type];
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
  if (fromProjectId && fromProjectId === toProjectId) throw new ApiError(400, "Pick a different project to transfer to");

  const [fromProject, toProject] = await Promise.all([
    fromProjectId ? prisma.project.findUnique({ where: { id: fromProjectId } }) : null,
    toProjectId ? prisma.project.findUnique({ where: { id: toProjectId } }) : null,
  ]);
  if (fromProjectId && !fromProject) throw new ApiError(400, "Unknown source project");
  if (toProjectId && !toProject) throw new ApiError(400, "Unknown destination project");

  const move = { itemId: body.itemId, type: body.type, qty: body.qty, fromProjectId, toProjectId };
  await assertMaterialAvailable(move, item);

  const fromLoc = fromProject
    ? fromProject.name
    : body.type === "SUPPLIER_TO_WAREHOUSE" || body.type === "SUPPLIER_TO_SITE"
      ? "Supplier"
      : warehouseLabel(item.warehouse);
  const toLoc = toProject ? toProject.name : body.type === "CONSUMED_ON_SITE" ? "Used on site" : warehouseLabel(item.warehouse);

  // A return or transfer waits for approval — except the Owner's own, which is approved right now.
  const isRequest = materialNeedsApproval(body.type) && user.role !== "OWNER";
  const decided = !isRequest && materialNeedsApproval(body.type) ? { decidedById: user.id, decidedByName: user.name, decidedAt: new Date() } : {};

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
        note: body.note || null,
        unitPrice: item.unitPrice,
        actorId: user.id,
        createdAt: body.submittedAt,
        status: isRequest ? "PENDING" : "APPLIED",
        ...decided,
      },
    });
    if (!isRequest) await applyMaterialMove(db, move);
    return movement;
  });

  await audit({
    entityType: "InventoryMovement",
    entityId: movement.id,
    actorId: user.id,
    actorName: user.name,
    action: isRequest ? "INVENTORY_REQUEST_SUBMITTED" : `STOCK_${body.type}`,
    diff: { item: item.name, qty: body.qty, unit: item.unit, type: body.type, from: fromLoc, to: toLoc, note: body.note || null },
  });

  return NextResponse.json(movement, { status: 201 });
});
