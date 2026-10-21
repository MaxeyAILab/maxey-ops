import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";

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
      warehouseQty: Number(item.currentQty),
      movementsRemoved: item._count.movements,
      onSite: item.projectStocks.filter((s) => Number(s.qty) !== 0).map((s) => ({ project: s.project.name, qty: Number(s.qty) })),
    },
  });
  return NextResponse.json({ ok: true });
});
