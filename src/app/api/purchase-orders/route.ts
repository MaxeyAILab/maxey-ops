import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import { projectOrCategoryLabel } from "@/lib/requisitions";
import { nextPoNumber } from "@/lib/po-number";
import { purchaseEstimate } from "@/lib/requisition-warehouse";

const poItemSchema = z.object({
  name: z.string().min(1),
  qty: z.coerce.number().positive(),
  unit: z.string().min(1),
  unitCost: z.coerce.number().min(0),
  /** supplier of the quote chosen for this item on the requisition — printed in the REMARKS column of the PO form */
  remarks: z.string().trim().max(200).nullish(),
  /** the requisition line this PO line buys — used to check (and, for the Owner, carry over) a changed quantity */
  requisitionItemId: z.string().nullish(),
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

  // Lines taken from the warehouse are issued from stock when the delivery is confirmed — buying them as well would charge twice.
  const reqItems = await prisma.requisitionItem.findMany({ where: { requisitionId: requisition.id }, select: { id: true, name: true, qty: true, unit: true, warehouseItemId: true, remarks: true, estUnitCost: true } });

  // Quantities: only the Owner may issue the PO for a different quantity than was approved (owner's request 2026-11-17); the
  // requisition line is changed to match, so the requisition, its estimate and the PO never disagree.
  const qtyChanges: { id: string; name: string; unit: string; from: number; to: number }[] = [];
  for (const line of body.items) {
    const ri = line.requisitionItemId ? reqItems.find((r) => r.id === line.requisitionItemId && !r.warehouseItemId) : null;
    if (line.requisitionItemId && !ri) throw new ApiError(400, `${line.name} is not a line to buy on this requisition`);
    if (ri && Math.abs(Number(ri.qty) - line.qty) > 0.0005) qtyChanges.push({ id: ri.id, name: ri.name, unit: ri.unit, from: Number(ri.qty), to: line.qty });
  }
  if (qtyChanges.length && user.role !== "OWNER") throw new ApiError(403, "Only the Owner can change the quantity — issue the PO for the approved quantities");
  const bought = new Set(reqItems.filter((i) => !i.warehouseItemId).map((i) => i.name.trim().toLowerCase()));
  const fromStock = reqItems.filter((i) => i.warehouseItemId && !bought.has(i.name.trim().toLowerCase())).map((i) => i.name.trim().toLowerCase());
  const doubled = body.items.find((i) => fromStock.includes(i.name.trim().toLowerCase()));
  if (doubled) throw new ApiError(400, `${doubled.name} is taken from the warehouse stock, not bought — remove it from the PO`);

  // each line carries the supplier of the quote chosen for it on the requisition (printed in the REMARKS column of the PO form)
  const supplierOf = new Map(reqItems.filter((i) => !i.warehouseItemId && i.remarks).map((i) => [i.name.trim().toLowerCase(), i.remarks!.trim()]));
  const lines = body.items.map((i) => ({ name: i.name, qty: i.qty, unit: i.unit, unitCost: i.unitCost, remarks: i.remarks?.trim() || supplierOf.get(i.name.trim().toLowerCase()) || null }));
  const totalCost = body.items.reduce((sum, i) => sum + i.qty * i.unitCost, 0);
  // The warehouse lines ride on the same PO at no cost (they are charged when issued), so that what leaves the warehouse is
  // verified by the driver and confirmed by the receiver like everything else — it is issued to the project only then.
  const warehouseLines = reqItems.filter((i) => i.warehouseItemId).map((i) => ({ name: i.name, qty: Number(i.qty), unit: i.unit, unitCost: 0, fromWarehouse: true, issueOnDelivery: true, warehouseItemId: i.warehouseItemId, requisitionItemId: i.id }));

  const po = await prisma.$transaction(async (db) => {
    const poNumber = await nextPoNumber(db);
    const po = await db.purchaseOrder.create({
      data: {
        poNumber,
        requisitionId: body.requisitionId,
        supplier: body.supplier,
        deliveryDate: body.deliveryDate,
        items: [...lines, ...warehouseLines],
        totalCost,
        createdById: user.id,
      },
    });
    for (const c of qtyChanges) await db.requisitionItem.update({ where: { id: c.id }, data: { qty: c.to } });
    const estimatedCost = qtyChanges.length
      ? purchaseEstimate(reqItems.map((r) => ({ ...r, qty: qtyChanges.find((c) => c.id === r.id)?.to ?? Number(r.qty) })))
      : undefined;
    await db.requisition.update({
      where: { id: body.requisitionId },
      data: { status: "PO_ISSUED", ...(estimatedCost !== undefined ? { estimatedCost } : {}) },
    });
    return po;
  });
  if (qtyChanges.length) {
    await audit({
      entityType: "Requisition",
      entityId: requisition.id,
      actorId: user.id,
      actorName: user.name,
      action: "REQUISITION_QTY_EDITED",
      diff: { onPo: po.poNumber, changes: qtyChanges.map((c) => ({ item: c.name, unit: c.unit, qty: { from: c.from, to: c.to } })) },
    });
  }

  await audit({
    entityType: "PurchaseOrder",
    entityId: po.id,
    actorId: user.id,
    actorName: user.name,
    action: "PO_CREATED",
    diff: {
      poNumber: po.poNumber,
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
