import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import { canAddInventoryCatalog } from "@/lib/access";
import { MATERIAL_CATEGORIES, MATERIAL_CATEGORY_LABEL, type MaterialCategoryValue } from "@/lib/material-category";

const createSchema = z.object({
  name: z.string().min(1).max(200),
  unit: z.string().min(1).max(30),
  currentQty: z.coerce.number().min(0).default(0),
  /** which of the four groups it belongs to */
  category: z.enum(MATERIAL_CATEGORIES.map((c) => c.value) as [string, ...string[]]).default("OTHERS"),
  /** price per unit in pesos (optional; can be entered later) */
  unitPrice: z.number().min(0).max(100_000_000).nullable().optional(),
});

/** POST /api/inventory/items — register a warehouse stock item (Spec 6.4). */
export const POST = handleApi(async (req: NextRequest) => {
  const user = await requireUser();
  if (!canAddInventoryCatalog(user)) throw new ApiError(403, "Not authorized for this action");
  const body = createSchema.parse(await req.json());

  const item = await prisma.warehouseItem.create({ data: { ...body, category: body.category as MaterialCategoryValue, unitPrice: body.unitPrice == null ? null : Math.round(body.unitPrice * 100) / 100 } });

  await audit({
    entityType: "WarehouseItem",
    entityId: item.id,
    actorId: user.id,
    actorName: user.name,
    action: "WAREHOUSE_ITEM_CREATED",
    diff: { name: body.name, initialQty: body.currentQty, category: MATERIAL_CATEGORY_LABEL[body.category as keyof typeof MATERIAL_CATEGORY_LABEL] },
  });

  return NextResponse.json(item, { status: 201 });
});
