import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import { canLogInventoryMovement, canLogInventoryUsage } from "@/lib/access";
import { savePhotos } from "@/lib/storage";
import { MAX_NEW_REQUEST_PHOTOS } from "@/lib/request-photos";
import { WAREHOUSE_VALUES, warehouseLabel } from "@/lib/warehouses";
import { MATERIAL_CATEGORIES } from "@/lib/material-category";
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
  itemId: z.string().optional().or(z.literal("")),
  /** a return of something that is not in the warehouse's list yet: it is added to the chosen warehouse as part of the return */
  newItem: z.object({ name: z.string().trim().min(1).max(200), unit: z.string().trim().min(1).max(30), category: z.enum(MATERIAL_CATEGORIES.map((c) => c.value) as [string, ...string[]]).default("OTHERS") }).optional(),
  /** which warehouse the materials go into (or come out of) — the item must be kept there */
  warehouse: z.enum(WAREHOUSE_VALUES).optional(),
  /** excess materials that were never logged on this site: allowed to come in even though the site has no record of them */
  excess: z.boolean().optional(),
  type: z.enum(MOVEMENT_TYPES),
  qty: z.coerce.number().positive(),
  fromProjectId: z.string().optional().or(z.literal("")),
  toProjectId: z.string().optional().or(z.literal("")),
  note: z.string().max(300).nullish().or(z.literal("")), // e.g. usage note: "poured column C4"
  photos: z.array(z.string()).max(MAX_NEW_REQUEST_PHOTOS).optional(), // compressed data URLs: what is being returned / transferred
});

/**
 * POST /api/inventory/movements — log a materials movement, offline-capable (the foreman logs transfers/usage from the
 * phone). Issuing to a site, usage and supplier deliveries are applied at once. A RETURN to the warehouse and a TRANSFER to
 * another project are requests (status PENDING): nothing moves until office staff approve them (PATCH /[id]) — the
 * Owner's own requests are approved on the spot. Either way the movement records who logged it. Photos of the items can be sent
 * with it (up to 4) so the approver can see what is coming back.
 */
export const POST = handleApi(async (req: NextRequest) => {
  const user = await requireUser();
  if (!canLogInventoryMovement(user)) throw new ApiError(403, "Not authorized for this action");
  const body = createSchema.parse(await req.json());
  if (body.type === "CONSUMED_ON_SITE" && !canLogInventoryUsage(user)) throw new ApiError(403, "You are not allowed to log usage — you can issue, return or transfer materials");

  const dup = await prisma.inventoryMovement.findUnique({
    where: { clientUuid: body.clientUuid },
  });
  if (dup) return NextResponse.json({ error: "Already synced", id: dup.id }, { status: 409 });

  // which item: one that exists, or (for a return only) a new one the warehouse does not have yet
  if (!body.itemId && !body.newItem) throw new ApiError(400, "Choose an item");
  if (body.newItem && body.type !== "SITE_TO_WAREHOUSE") throw new ApiError(400, "A new item can only be added as part of a return to the warehouse");
  if (body.excess && body.type !== "SITE_TO_WAREHOUSE") throw new ApiError(400, "Excess materials are only logged when returning them to the warehouse");
  const targetWarehouse = body.warehouse ?? "MAIN";
  let item = body.itemId ? await prisma.warehouseItem.findUnique({ where: { id: body.itemId } }) : null;
  if (body.itemId && !item) throw new ApiError(404, "Warehouse item not found");
  if (item && body.warehouse && item.warehouse !== body.warehouse) throw new ApiError(400, `${item.name} is kept in the ${warehouseLabel(item.warehouse)}, not the ${warehouseLabel(body.warehouse)}`);
  if (!item && body.newItem) {
    // the same name already in that warehouse is that item, not a duplicate
    item = await prisma.warehouseItem.findFirst({ where: { warehouse: targetWarehouse, name: { equals: body.newItem.name, mode: "insensitive" } } });
  }
  const creatingItem = !item && !!body.newItem;
  const excess = !!body.excess || !!body.newItem; // "not in the list yet" means the site has no record of it either

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

  // a brand-new item has nothing on site and nothing in the warehouse yet; the checks below are for items that exist
  const shown = item ?? { name: body.newItem!.name, unit: body.newItem!.unit, currentQty: 0, warehouse: targetWarehouse, unitPrice: null };
  if (item) await assertMaterialAvailable({ itemId: item.id, type: body.type, qty: body.qty, fromProjectId, toProjectId, excess }, item);

  const fromLoc = fromProject
    ? fromProject.name
    : body.type === "SUPPLIER_TO_WAREHOUSE" || body.type === "SUPPLIER_TO_SITE"
      ? "Supplier"
      : warehouseLabel(shown.warehouse);
  const toLoc = toProject ? toProject.name : body.type === "CONSUMED_ON_SITE" ? "Used on site" : warehouseLabel(shown.warehouse);

  // A return or transfer waits for approval — except the Owner's own, which is approved right now.
  const isRequest = materialNeedsApproval(body.type) && user.role !== "OWNER";
  const decided = !isRequest && materialNeedsApproval(body.type) ? { decidedById: user.id, decidedByName: user.name, decidedAt: new Date() } : {};

  const photoUrls = await savePhotos(body.photos);
  const movement = await prisma.$transaction(async (db) => {
    const itemId = item
      ? item.id
      : (await db.warehouseItem.create({ data: { name: body.newItem!.name, unit: body.newItem!.unit, category: body.newItem!.category as never, warehouse: targetWarehouse, currentQty: 0 } })).id;
    const movement = await db.inventoryMovement.create({
      data: {
        clientUuid: body.clientUuid,
        itemId,
        type: body.type,
        qty: body.qty,
        fromLoc,
        toLoc,
        fromProjectId,
        toProjectId,
        note: body.note || null,
        unitPrice: shown.unitPrice,
        excess,
        newItem: creatingItem,
        photos: photoUrls.length ? photoUrls : undefined,
        actorId: user.id,
        createdAt: body.submittedAt,
        status: isRequest ? "PENDING" : "APPLIED",
        ...decided,
      },
    });
    if (!isRequest) await applyMaterialMove(db, { itemId, type: body.type, qty: body.qty, fromProjectId, toProjectId, excess });
    return movement;
  });

  await audit({
    entityType: "InventoryMovement",
    entityId: movement.id,
    actorId: user.id,
    actorName: user.name,
    action: isRequest ? "INVENTORY_REQUEST_SUBMITTED" : `STOCK_${body.type}`,
    diff: { item: shown.name, qty: body.qty, unit: shown.unit, type: body.type, from: fromLoc, to: toLoc, note: body.note || null, photos: photoUrls.length, ...(excess ? { excessNotLoggedOnSite: true } : {}), ...(creatingItem ? { newItemAddedTo: warehouseLabel(shown.warehouse) } : {}) },
  });

  return NextResponse.json(movement, { status: 201 });
});
