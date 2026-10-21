import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import { canSeeStockPrices } from "@/lib/access";

const schema = z.object({
  prices: z
    .array(z.object({ id: z.string().min(1), unitPrice: z.number().min(0).max(100_000_000).nullable() }))
    .min(1)
    .max(300),
});

/**
 * PUT /api/inventory/prices — set the price per unit of many stock items at once (the "Set prices" table on the stock page).
 * Only items whose price actually changes are written, all together or not at all; one audit entry lists what each price was
 * before and after. Office staff, Owner, PM and Purchasing.
 */
export const PUT = handleApi(async (req: NextRequest) => {
  const user = await requireUser();
  if (!canSeeStockPrices(user)) throw new ApiError(403, "Not authorized for this action");
  const body = schema.parse(await req.json());
  const ids = [...new Set(body.prices.map((p) => p.id))];
  const existing = await prisma.warehouseItem.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, unitPrice: true } });
  const byId = new Map(existing.map((i) => [i.id, i]));
  if (byId.size !== ids.length) throw new ApiError(404, "One of those stock items no longer exists — refresh the page");

  const changes: { id: string; item: string; from: number | null; to: number | null }[] = [];
  for (const p of body.prices) {
    const item = byId.get(p.id)!;
    const to = p.unitPrice === null ? null : Math.round(p.unitPrice * 100) / 100;
    const from = item.unitPrice === null ? null : Number(item.unitPrice);
    if (to !== from) changes.push({ id: item.id, item: item.name, from, to });
  }
  if (changes.length === 0) return NextResponse.json({ ok: true, updated: 0 });

  await prisma.$transaction(changes.map((c) => prisma.warehouseItem.update({ where: { id: c.id }, data: { unitPrice: c.to } })));
  await audit({
    entityType: "WarehouseItem",
    entityId: changes[0].id,
    actorId: user.id,
    actorName: user.name,
    action: "WAREHOUSE_PRICES_UPDATED",
    diff: { count: changes.length, changes: changes.slice(0, 100).map((c) => ({ item: c.item, from: c.from, to: c.to })) } as never,
  });
  return NextResponse.json({ ok: true, updated: changes.length });
});
