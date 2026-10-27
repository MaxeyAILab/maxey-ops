import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import { projectOrCategoryLabel } from "@/lib/requisitions";

const poItemSchema = z.object({
  name: z.string().min(1),
  qty: z.coerce.number().positive(),
  unit: z.string().min(1),
  unitCost: z.coerce.number().min(0),
});

const createSchema = z.object({
  requisitionId: z.string().min(1),
  supplier: z.string().min(1).max(200),
  deliveryDate: z.coerce.date().optional(),
  items: z.array(poItemSchema).min(1),
});

/**
 * POST /api/purchase-orders — Purchasing converts an approved requisition
 * into a PO (Spec 6.2). The PO total becomes the committed cost against the
 * project budget; no manual re-entry into accounting.
 */
export const POST = handleApi(async (req: NextRequest) => {
  const user = await requireUser(["PURCHASING", "OWNER"]);
  const body = createSchema.parse(await req.json());

  const requisition = await prisma.requisition.findUnique({
    where: { id: body.requisitionId },
    include: { purchaseOrder: true, project: true },
  });
  if (!requisition) throw new ApiError(404, "Requisition not found");
  if (requisition.status !== "APPROVED") {
    throw new ApiError(400, "Only approved requisitions can be converted to a PO");
  }
  if (requisition.purchaseOrder) {
    throw new ApiError(400, "A PO already exists for this requisition");
  }

  // Lines taken from the warehouse were issued from stock when the requisition was approved — buying them again would charge twice.
  const reqItems = await prisma.requisitionItem.findMany({ where: { requisitionId: requisition.id }, select: { name: true, warehouseItemId: true } });
  const bought = new Set(reqItems.filter((i) => !i.warehouseItemId).map((i) => i.name.trim().toLowerCase()));
  const fromStock = reqItems.filter((i) => i.warehouseItemId && !bought.has(i.name.trim().toLowerCase())).map((i) => i.name.trim().toLowerCase());
  const doubled = body.items.find((i) => fromStock.includes(i.name.trim().toLowerCase()));
  if (doubled) throw new ApiError(400, `${doubled.name} is taken from the warehouse stock, not bought — remove it from the PO`);

  const totalCost = body.items.reduce((sum, i) => sum + i.qty * i.unitCost, 0);
  const year = new Date().getFullYear();
  // one more than the highest number this year — counting POs would reuse a number once an earlier PO has been deleted
  const thisYear = await prisma.purchaseOrder.findMany({ where: { poNumber: { startsWith: `PO-${year}-` } }, select: { poNumber: true } });
  const highest = thisYear.reduce((m, p) => Math.max(m, Number(p.poNumber.slice(`PO-${year}-`.length)) || 0), 0);
  const poNumber = `PO-${year}-${String(highest + 1).padStart(4, "0")}`;

  const po = await prisma.$transaction(async (db) => {
    const po = await db.purchaseOrder.create({
      data: {
        poNumber,
        requisitionId: body.requisitionId,
        supplier: body.supplier,
        deliveryDate: body.deliveryDate,
        items: body.items,
        totalCost,
        createdById: user.id,
      },
    });
    await db.requisition.update({
      where: { id: body.requisitionId },
      data: { status: "PO_ISSUED" },
    });
    return po;
  });

  await audit({
    entityType: "PurchaseOrder",
    entityId: po.id,
    actorId: user.id,
    actorName: user.name,
    action: "PO_CREATED",
    diff: {
      poNumber,
      supplier: body.supplier,
      totalCost,
      project: projectOrCategoryLabel(requisition),
    },
  });

  return NextResponse.json(po, { status: 201 });
});

/** GET /api/purchase-orders */
export const GET = handleApi(async () => {
  await requireUser(["PURCHASING", "OWNER", "ACCOUNTING", "PM", "FOREMAN", "DRIVER"]);
  const pos = await prisma.purchaseOrder.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      requisition: {
        include: { project: { select: { name: true } }, submittedBy: { select: { name: true } } },
      },
    },
  });
  return NextResponse.json(pos);
});
