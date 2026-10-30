import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import { projectOrCategoryLabel } from "@/lib/requisitions";
import { warehouseLabel } from "@/lib/warehouses";
import { nextPoNumber, WAREHOUSE_SUPPLIER } from "@/lib/po-number";
import { reservedStock } from "@/lib/tally-out-db";
import { planWarehouseUse, purchaseEstimate, warehouseShortfalls } from "@/lib/requisition-warehouse";

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    // Canvassing (Spec 6.2): record one supplier's price for one item.
    // Several can be recorded per item — the first one recorded for an item
    // is auto-selected (so a single-supplier item needs no extra step), and
    // any of them can later be picked via select_quote.
    action: z.literal("add_quote"),
    itemId: z.string().min(1),
    supplier: z.string().min(1).max(200),
    unitCost: z.coerce.number().min(0),
    notes: z.string().max(300).optional().or(z.literal("")),
  }),
  z.object({
    // Pick which of an item's recorded quotes is the one to approve —
    // mirrors that quote's price/supplier onto the item so everything
    // downstream (PO creation, PDFs, dashboard rollups) keeps reading a
    // single estUnitCost/remarks pair, same as before quotes existed.
    action: z.literal("select_quote"),
    itemId: z.string().min(1),
    quoteId: z.string().min(1),
  }),
  z.object({
    // Take this item from warehouse stock instead of buying it. If the warehouse holds less than the item asks for, `qty`
    // says how many to take: the item is split, and the rest stays as a line to buy.
    action: z.literal("use_warehouse"),
    itemId: z.string().min(1),
    warehouseItemId: z.string().min(1),
    qty: z.coerce.number().positive().optional(),
  }),
  z.object({
    // Back to buying it from a supplier.
    action: z.literal("use_supplier"),
    itemId: z.string().min(1),
  }),
  z.object({ action: z.literal("approve") }),
  z.object({
    action: z.literal("reject"),
    reason: z.string().min(1).max(1000),
  }),
]);

/** Recompute the requisition total from each item's currently-selected
 * quote (estUnitCost), and move SUBMITTED -> UNDER_REVIEW the first time
 * anyone starts canvassing — same transition the old single-price flow made. */
async function refreshRequisitionAfterCosting(requisitionId: string, wasSubmitted: boolean) {
  const items = await prisma.requisitionItem.findMany({ where: { requisitionId } });
  // lines taken from the warehouse are charged when they are issued, not here — otherwise the project pays for them twice
  const estimatedCost = purchaseEstimate(items);
  await prisma.requisition.update({
    where: { id: requisitionId },
    data: { estimatedCost, ...(wasSubmitted ? { status: "UNDER_REVIEW" as const } : {}) },
  });
  return estimatedCost;
}

/**
 * PATCH /api/requisitions/[id] — workflow transitions.
 * Approvals are append-only records: approve/reject stamps who + when and is
 * never overwritten (Spec §4 conflict rule).
 */
export const PATCH = handleApi(
  async (req: NextRequest, { params }: { params: { id: string } }) => {
    const body = actionSchema.parse(await req.json());

    const requisition = await prisma.requisition.findUnique({
      where: { id: params.id },
      include: { project: true, submittedBy: true, items: true },
    });
    if (!requisition) throw new ApiError(404, "Requisition not found");

    if (body.action === "use_warehouse" || body.action === "use_supplier") {
      const user = await requireUser(["PM", "OWNER", "ACCOUNTING", "PURCHASING"]);
      if (!["SUBMITTED", "UNDER_REVIEW"].includes(requisition.status)) {
        throw new ApiError(400, `Cannot change where the items come from once the requisition is ${requisition.status}`);
      }
      const item = requisition.items.find((i) => i.id === body.itemId);
      if (!item) throw new ApiError(400, "Unknown item on this requisition");
      const wasSubmitted = requisition.status === "SUBMITTED";

      if (body.action === "use_supplier") {
        if (!item.warehouseItemId) return NextResponse.json(requisition);
        // back on the buying list: pick the first canvassed price again if there is one
        const first = await prisma.itemQuote.findFirst({ where: { requisitionItemId: item.id }, orderBy: { createdAt: "asc" } });
        await prisma.requisitionItem.update({
          where: { id: item.id },
          data: { warehouseItemId: null, selectedQuoteId: first?.id ?? null, estUnitCost: first?.unitCost ?? null, remarks: first?.supplier ?? null },
        });
        const estimatedCost = await refreshRequisitionAfterCosting(requisition.id, wasSubmitted);
        await audit({
          entityType: "Requisition",
          entityId: requisition.id,
          actorId: user.id,
          actorName: user.name,
          action: "REQUISITION_ITEM_TO_SUPPLIER",
          diff: { item: item.name, estimatedCost },
        });
        return NextResponse.json(await prisma.requisition.findUnique({ where: { id: requisition.id } }));
      }

      if (!requisition.projectId) throw new ApiError(400, "Materials can only be taken from the warehouse for a project or job");
      const w = await prisma.warehouseItem.findUnique({ where: { id: body.warehouseItemId } });
      if (!w) throw new ApiError(404, "Warehouse item not found");
      const wanted = body.qty ?? Number(item.qty);
      if (wanted > Number(item.qty)) throw new ApiError(400, `The item only asks for ${Number(item.qty)} ${item.unit}`);
      const { fromWarehouse, toBuy } = planWarehouseUse(Number(item.qty), Math.min(Number(w.currentQty), wanted));
      if (fromWarehouse <= 0) throw new ApiError(400, `${w.name} has none in the ${warehouseLabel(w.warehouse)}`);
      await prisma.$transaction(async (db) => {
        await db.requisitionItem.update({
          where: { id: item.id },
          // the price of a taken-from-warehouse line comes from the warehouse, so any canvassed price is no longer selected
          data: { name: w.name, unit: w.unit, qty: fromWarehouse, warehouseItemId: w.id, selectedQuoteId: null, estUnitCost: null, remarks: null },
        });
        if (toBuy > 0) {
          // the part the warehouse cannot cover stays on the buying list as its own line
          await db.requisitionItem.create({ data: { requisitionId: requisition.id, name: item.name, spec: item.spec, qty: toBuy, unit: item.unit } });
        }
      });
      const estimatedCost = await refreshRequisitionAfterCosting(requisition.id, wasSubmitted);
      await audit({
        entityType: "Requisition",
        entityId: requisition.id,
        actorId: user.id,
        actorName: user.name,
        action: "REQUISITION_ITEM_FROM_WAREHOUSE",
        diff: { item: w.name, qty: fromWarehouse, unit: w.unit, warehouse: warehouseLabel(w.warehouse), leftToBuy: toBuy, estimatedCost },
      });
      return NextResponse.json(await prisma.requisition.findUnique({ where: { id: requisition.id } }));
    }

    if (body.action === "add_quote" || body.action === "select_quote") {
      const user = await requireUser(["PM", "OWNER", "ACCOUNTING", "PURCHASING"]);
      if (!["SUBMITTED", "UNDER_REVIEW"].includes(requisition.status)) {
        throw new ApiError(400, `Cannot cost a requisition in ${requisition.status} state`);
      }
      const item = requisition.items.find((i) => i.id === body.itemId);
      if (!item) throw new ApiError(400, "Unknown item on this requisition");
      if (item.warehouseItemId) throw new ApiError(400, "This item comes from the warehouse — switch it back to a supplier before adding a price");
      const wasSubmitted = requisition.status === "SUBMITTED";

      if (body.action === "add_quote") {
        const quote = await prisma.itemQuote.create({
          data: {
            requisitionItemId: item.id,
            supplier: body.supplier,
            unitCost: body.unitCost,
            notes: body.notes || null,
            submittedById: user.id,
          },
        });
        // First quote recorded for an item is auto-selected — a
        // single-supplier item still costs in one step, not two.
        const autoSelected = !item.selectedQuoteId;
        if (autoSelected) {
          await prisma.requisitionItem.update({
            where: { id: item.id },
            data: { selectedQuoteId: quote.id, estUnitCost: quote.unitCost, remarks: quote.supplier },
          });
        }
        const estimatedCost = await refreshRequisitionAfterCosting(requisition.id, wasSubmitted);
        await audit({
          entityType: "Requisition",
          entityId: requisition.id,
          actorId: user.id,
          actorName: user.name,
          action: "REQUISITION_QUOTE_ADDED",
          diff: { item: item.name, supplier: body.supplier, unitCost: body.unitCost, autoSelected, estimatedCost },
        });
      } else {
        const quote = await prisma.itemQuote.findUnique({ where: { id: body.quoteId } });
        if (!quote || quote.requisitionItemId !== item.id) {
          throw new ApiError(400, "Unknown quote for this item");
        }
        await prisma.requisitionItem.update({
          where: { id: item.id },
          data: { selectedQuoteId: quote.id, estUnitCost: quote.unitCost, remarks: quote.supplier },
        });
        const estimatedCost = await refreshRequisitionAfterCosting(requisition.id, wasSubmitted);
        await audit({
          entityType: "Requisition",
          entityId: requisition.id,
          actorId: user.id,
          actorName: user.name,
          action: "REQUISITION_QUOTE_SELECTED",
          diff: { item: item.name, supplier: quote.supplier, unitCost: quote.unitCost.toString(), estimatedCost },
        });
      }

      const updated = await prisma.requisition.findUnique({ where: { id: requisition.id } });
      return NextResponse.json(updated);
    }

    // approve / reject — Owner only (Spec §3)
    const user = await requireUser(["OWNER"]);
    if (["APPROVED", "REJECTED", "PO_ISSUED", "DELIVERED"].includes(requisition.status)) {
      throw new ApiError(400, `Requisition already ${requisition.status}`);
    }

    if (body.action === "approve") {
      // Lines taken from the warehouse are NOT put on the project's materials list now. The Owner's approval is the approval of the
      // issue; the materials leave the warehouse and reach the project only when the driver has verified the delivery and the
      // receiver on site has confirmed it. Until then the quantities are reserved so nobody else can promise them.
      const fromWarehouse = requisition.items.filter((i) => i.warehouseItemId && !i.issuedMovementId);
      if (fromWarehouse.length && !requisition.project) throw new ApiError(400, "Materials can only be taken from the warehouse for a project or job");
      const buying = requisition.items.filter((i) => !i.warehouseItemId);

      const updated = await prisma.$transaction(async (db) => {
        if (fromWarehouse.length) {
          const stock = await db.warehouseItem.findMany({ where: { id: { in: fromWarehouse.map((i) => i.warehouseItemId!) } } });
          const reserved = await reservedStock(db); // this requisition is not approved yet, so its own lines are not in it
          const map = new Map(stock.map((w) => [w.id, { id: w.id, name: w.name, unit: w.unit, warehouse: warehouseLabel(w.warehouse), currentQty: Math.max(0, Number(w.currentQty) - (reserved.get(w.id) ?? 0)) }]));
          const short = warehouseShortfalls(fromWarehouse, map);
          if (short.length) {
            throw new ApiError(
              400,
              `Not enough in the warehouse to approve: ${short
                .map((x) => `${x.name} — asked ${x.wanted} ${x.unit}, ${x.warehouse || "warehouse"} has ${x.available} free (the rest is reserved for other forms)`)
                .join("; ")}. Take only what is there (the rest is bought) or switch the item back to a supplier.`
            );
          }
        }
        const claim = await db.requisition.updateMany({
          where: { id: params.id, status: { in: ["SUBMITTED", "UNDER_REVIEW"] } },
          data: { status: "APPROVED", approvedById: user.id, approvedAt: new Date() },
        });
        if (claim.count !== 1) throw new ApiError(409, "This requisition was just decided by someone else — reload the page");

        // Nothing is bought: there is no purchase to make, but the stock still has to reach the site and be verified like any
        // delivery. So a PO at no cost is opened for it (the cost is charged when the warehouse issue happens, at confirmation);
        // the requisition only becomes Delivered once the driver verifies and the receiver confirms, same as every other delivery.
        if (buying.length === 0 && fromWarehouse.length > 0) {
          await db.purchaseOrder.create({
            data: {
              poNumber: await nextPoNumber(db),
              requisitionId: params.id,
              supplier: WAREHOUSE_SUPPLIER,
              items: fromWarehouse.map((l) => ({ name: l.name, qty: Number(l.qty), unit: l.unit, unitCost: 0, fromWarehouse: true, issueOnDelivery: true, warehouseItemId: l.warehouseItemId, requisitionItemId: l.id })) as never,
              totalCost: 0,
              createdById: user.id,
            },
          });
          await db.requisition.update({ where: { id: params.id }, data: { status: "PO_ISSUED" } });
        }
        return db.requisition.findUniqueOrThrow({ where: { id: params.id } });
      });

      await audit({
        entityType: "Requisition",
        entityId: requisition.id,
        actorId: user.id,
        actorName: user.name,
        action: "REQUISITION_APPROVED",
        diff: { estimatedCost: requisition.estimatedCost?.toString() ?? null, fromWarehouseOnDelivery: fromWarehouse.map((l) => ({ item: l.name, qty: Number(l.qty), unit: l.unit })) },
      });
      // Auto-forward to Purchasing (Spec 6.2) — cost now committed vs budget; only if something is left to buy
      if (buying.length) {
        await notify({
          to: { name: "Purchasing" },
          subject: "Requisition approved — create PO",
          message: `${projectOrCategoryLabel(requisition)}: requisition from ${requisition.submittedBy.name} approved.`,
        });
      }
      return NextResponse.json(updated);
    }

    const updated = await prisma.requisition.update({
      where: { id: params.id },
      data: { status: "REJECTED", rejectedReason: body.reason },
    });
    await audit({
      entityType: "Requisition",
      entityId: requisition.id,
      actorId: user.id,
      actorName: user.name,
      action: "REQUISITION_REJECTED",
      diff: { reason: body.reason },
    });
    await notify({
      to: { name: requisition.submittedBy.name },
      subject: "Requisition rejected",
      message: body.reason,
    });
    return NextResponse.json(updated);
  }
);

/**
 * DELETE /api/requisitions/[id] — Owner-only (Spec §3: destructive actions
 * stay with the Owner; every other role, present and future, never gets
 * this). Blocked while an active (non-cancelled) Purchase Order exists —
 * cancel it first (PATCH /api/purchase-orders/[id]). Also blocked if a
 * cancelled PO still has real delivery history against it — that's genuine
 * operational activity, not something a delete should erase.
 */
export const DELETE = handleApi(
  async (_req: NextRequest, { params }: { params: { id: string } }) => {
    const user = await requireUser(["OWNER"]);

    const requisition = await prisma.requisition.findUnique({
      where: { id: params.id },
      include: { project: true, submittedBy: true, purchaseOrder: true },
    });
    if (!requisition) throw new ApiError(404, "Requisition not found");
    if (requisition.purchaseOrder) {
      if (requisition.purchaseOrder.status !== "CANCELLED") {
        throw new ApiError(
          400,
          "Cannot delete — a purchase order already exists. Cancel it first."
        );
      }
      const deliveryCount = await prisma.delivery.count({
        where: { poId: requisition.purchaseOrder.id },
      });
      if (deliveryCount > 0) {
        throw new ApiError(
          400,
          "Cannot delete — delivery history is recorded against this requisition's (cancelled) purchase order."
        );
      }
    }

    await audit({
      entityType: "Requisition",
      entityId: requisition.id,
      actorId: user.id,
      actorName: user.name,
      action: "REQUISITION_DELETED",
      diff: {
        project: projectOrCategoryLabel(requisition),
        submittedBy: requisition.submittedBy.name,
        status: requisition.status,
        cancelledPo: requisition.purchaseOrder?.poNumber ?? null,
      },
    });
    await prisma.$transaction([
      ...(requisition.purchaseOrder
        ? [prisma.purchaseOrder.delete({ where: { id: requisition.purchaseOrder.id } })]
        : []),
      prisma.requisition.delete({ where: { id: params.id } }),
    ]);

    return NextResponse.json({ ok: true });
  }
);
