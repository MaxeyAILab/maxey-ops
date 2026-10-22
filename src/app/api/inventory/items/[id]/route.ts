import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { z } from "zod";
import { NextRequest } from "next/server";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import { canAddInventoryCatalog } from "@/lib/access";
import { MATERIAL_CATEGORIES, MATERIAL_CATEGORY_LABEL, isMaterialCategory } from "@/lib/material-category";
import { WAREHOUSE_VALUES, warehouseLabel, type WarehouseValue } from "@/lib/warehouses";

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    unit: z.string().trim().min(1).max(30).optional(),
    category: z.enum(MATERIAL_CATEGORIES.map((c) => c.value) as [string, ...string[]]).optional(),
    currentQty: z.coerce.number().min(0).max(1_000_000_000).optional(),
    /** moves the item (with its quantity) to another warehouse — for one that was entered in the wrong one */
    warehouse: z.enum(WAREHOUSE_VALUES).optional(),
    /** price per unit in pesos; null removes the price */
    unitPrice: z.number().min(0).max(100_000_000).nullable().optional(),
    /** required when the warehouse quantity is changed by hand */
    qtyReason: z.string().trim().max(300).optional(),
  })
  .refine((b) => b.name !== undefined || b.unit !== undefined || b.category !== undefined || b.currentQty !== undefined || b.unitPrice !== undefined || b.warehouse !== undefined, { message: "Nothing to change" });

/**
 * PATCH /api/inventory/items/[id] — correct a stock item after it was added: its name, unit, category, the warehouse it is
 * kept in, or the quantity in the warehouse. The people who can add items can edit them (office staff, Owner, PM, Purchasing). Changing the quantity by hand
 * needs a reason, and the audit log keeps who changed what from what to what.
 */
export const PATCH = handleApi(async (req: NextRequest, { params }: { params: { id: string } }) => {
  const user = await requireUser();
  if (!canAddInventoryCatalog(user)) throw new ApiError(403, "Not authorized for this action");
  const body = patchSchema.parse(await req.json());
  const item = await prisma.warehouseItem.findUnique({ where: { id: params.id } });
  if (!item) throw new ApiError(404, "Stock item not found");

  const data: { name?: string; unit?: string; category?: "CIVIL_ARCHITECTURAL" | "PLUMBING" | "ELECTRICAL" | "OTHERS"; currentQty?: number; unitPrice?: number | null; warehouse?: WarehouseValue } = {};
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  if (body.name !== undefined && body.name !== item.name) {
    data.name = body.name;
    changes.name = { from: item.name, to: body.name };
  }
  if (body.unit !== undefined && body.unit !== item.unit) {
    data.unit = body.unit;
    changes.unit = { from: item.unit, to: body.unit };
  }
  if (body.category !== undefined && isMaterialCategory(body.category) && body.category !== item.category) {
    data.category = body.category;
    changes.category = { from: MATERIAL_CATEGORY_LABEL[item.category], to: MATERIAL_CATEGORY_LABEL[body.category] };
  }
  if (body.warehouse !== undefined && body.warehouse !== item.warehouse) {
    data.warehouse = body.warehouse;
    changes.warehouse = { from: warehouseLabel(item.warehouse), to: warehouseLabel(body.warehouse) };
  }
  if (body.currentQty !== undefined && body.currentQty !== Number(item.currentQty)) {
    if (!body.qtyReason || body.qtyReason.length < 3) throw new ApiError(400, "Say why the quantity is being changed");
    data.currentQty = body.currentQty;
    changes.quantity = { from: Number(item.currentQty), to: body.currentQty };
  }
  if (body.unitPrice !== undefined) {
    const next = body.unitPrice === null ? null : Math.round(body.unitPrice * 100) / 100;
    const was = item.unitPrice === null ? null : Number(item.unitPrice);
    if (next !== was) {
      data.unitPrice = next;
      changes.price = { from: was, to: next };
    }
  }
  if (Object.keys(changes).length === 0) return NextResponse.json({ ok: true });

  await prisma.warehouseItem.update({ where: { id: item.id }, data });
  await audit({
    entityType: "WarehouseItem",
    entityId: item.id,
    actorId: user.id,
    actorName: user.name,
    action: "WAREHOUSE_ITEM_EDITED",
    diff: { item: item.name, changes, ...(changes.quantity ? { reason: body.qtyReason } : {}) } as never,
  });
  return NextResponse.json({ ok: true });
});

/**
 * DELETE /api/inventory/items/[id] — Owner only: remove a warehouse stock item, for example one entered while testing. It also
 * removes the item's logged movements and the on-site stock records of the projects it was issued to, so nothing is left
 * pointing at it. The audit log keeps a full copy of what was removed.
 */
export const DELETE = handleApi(async (_req: Request, { params }: { params: { id: string } }) => {
  const user = await requireUser(["OWNER"]);
  const item = await prisma.warehouseItem.findUnique({
    where: { id: params.id },
    include: { _count: { select: { movements: true } }, projectStocks: { select: { qty: true, project: { select: { name: true } } } } },
  });
  if (!item) throw new ApiError(404, "Stock item not found");

  await prisma.$transaction(async (db) => {
    await db.projectMaterialStock.deleteMany({ where: { itemId: item.id } });
    await db.inventoryMovement.deleteMany({ where: { itemId: item.id } });
    await db.warehouseItem.delete({ where: { id: item.id } });
  });

  await audit({
    entityType: "WarehouseItem",
    entityId: item.id,
    actorId: user.id,
    actorName: user.name,
    action: "WAREHOUSE_ITEM_DELETED",
    diff: {
      name: item.name,
      unit: item.unit,
      warehouse: warehouseLabel(item.warehouse),
      warehouseQty: Number(item.currentQty),
      movementsRemoved: item._count.movements,
      onSite: item.projectStocks.filter((s) => Number(s.qty) !== 0).map((s) => ({ project: s.project.name, qty: Number(s.qty) })),
    },
  });
  return NextResponse.json({ ok: true });
});
