import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { handleApi, requireUser } from "@/lib/rbac";

const createSchema = z.object({
  name: z.string().min(1).max(200),
  unit: z.string().min(1).max(30),
  currentQty: z.coerce.number().min(0).default(0),
});

/** POST /api/inventory/items — register a warehouse stock item (Spec 6.4). */
export const POST = handleApi(async (req: NextRequest) => {
  const user = await requireUser(["PURCHASING", "OWNER", "PM"]);
  const body = createSchema.parse(await req.json());

  const item = await prisma.warehouseItem.create({ data: body });

  await audit({
    entityType: "WarehouseItem",
    entityId: item.id,
    actorId: user.id,
    actorName: user.name,
    action: "WAREHOUSE_ITEM_CREATED",
    diff: { name: body.name, initialQty: body.currentQty },
  });

  return NextResponse.json(item, { status: 201 });
});
