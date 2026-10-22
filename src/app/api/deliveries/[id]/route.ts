import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import { projectOrCategoryLabel } from "@/lib/requisitions";
import { adjustRequisitionItems, discrepancyLines, planAdjustment, type ChecklistRow, type PoLine } from "@/lib/delivery-adjust";
import { revertAcceptance, syncPoStatus, type StoredAdjustment } from "@/lib/delivery-db";

const editRow = z.object({
  item: z.string().min(1),
  receivedQty: z.coerce.number().min(0).max(1_000_000),
  ok: z.boolean(),
  remarks: z.string().max(500).optional().or(z.literal("")),
});

const patchSchema = z.discriminatedUnion("action", [
  // fix what was recorded on the delivery (the quantity received, whether it was in order, remarks, who drove / received)
  z.object({
    action: z.literal("edit"),
    checklist: z.array(editRow).min(1).max(100),
    driverName: z.string().max(200).optional().or(z.literal("")),
    recipientName: z.string().max(200).optional().or(z.literal("")),
    reason: z.string().trim().min(3).max(300),
  }),
  // accept a delivery that does not match the PO as final, with a reason — the PO and requisition follow what was delivered
  z.object({
    action: z.literal("accept"),
    reason: z.string().trim().min(5).max(500),
    /** the PO total the Owner saw when deciding; refused if the PO has changed since */
    expectedTotalAfter: z.number().optional(),
  }),
  // take an acceptance back: the PO and requisition return to what they were
  z.object({ action: z.literal("undo_accept"), reason: z.string().trim().min(3).max(300) }),
]);

const loadDelivery = (id: string) =>
  prisma.delivery.findUnique({
    where: { id },
    include: {
      po: { include: { requisition: { include: { project: true, items: { select: { id: true, name: true, qty: true, estUnitCost: true } } } } } },
    },
  });

/**
 * PATCH /api/deliveries/[id] — Owner only. Corrects a delivery that was recorded wrongly, or settles one that did not match the PO:
 *  - edit: change the quantity received / in-order tick / remarks (and the driver and receiver). The delivery is re-checked
 *    against the PO — it becomes "complete" only if everything now tallies — and the PO and requisition status follow. Editing an
 *    accepted delivery takes its acceptance back first (and undoes the PO / requisition change), so nothing is left half-way.
 *  - accept: the Owner accepts the delivery as final although it does not tally, with a reason. The PO items are set to the
 *    quantities delivered, the PO total (which is the project's committed cost) and the requisition follow, and the PO and
 *    requisition become Delivered. What was changed is kept on the delivery.
 *  - undo_accept: reverses an acceptance.
 * Everything is recorded in the audit log with who, what it was before, and the reason.
 */
export const PATCH = handleApi(async (req: NextRequest, { params }: { params: { id: string } }) => {
  const user = await requireUser(["OWNER"]);
  const body = patchSchema.parse(await req.json());
  const d = await loadDelivery(params.id);
  if (!d) throw new ApiError(404, "Delivery not found");
  const po = d.po;
  if (po.status === "CANCELLED") throw new ApiError(400, "This PO was cancelled — its deliveries can't be changed");
  const label = projectOrCategoryLabel(po.requisition);
  const stored = d.checklist as unknown as ChecklistRow[];

  // ------------------------------------------------------------------ edit
  if (body.action === "edit") {
    const byName = new Map(stored.map((c) => [c.item, c]));
    for (const r of body.checklist) if (!byName.has(r.item)) throw new ApiError(400, `“${r.item}” is not on this delivery`);
    const next: ChecklistRow[] = stored.map((c) => {
      const r = body.checklist.find((x) => x.item === c.item);
      return r ? { item: c.item, orderedQty: c.orderedQty, receivedQty: r.receivedQty, ok: r.ok, remarks: r.remarks || "" } : c;
    });
    const lines = discrepancyLines(next);
    const changes = next.flatMap((c, i) => {
      const was = stored[i];
      return was.receivedQty !== c.receivedQty || was.ok !== c.ok || (was.remarks ?? "") !== (c.remarks ?? "")
        ? [{ item: c.item, received: { from: was.receivedQty, to: c.receivedQty }, ok: { from: was.ok, to: c.ok }, remarks: { from: was.remarks ?? "", to: c.remarks ?? "" } }]
        : [];
    });
    const driver = body.driverName !== undefined ? body.driverName || null : d.driverName;
    const recipient = body.recipientName !== undefined ? body.recipientName || null : d.recipientName;
    if (changes.length === 0 && driver === d.driverName && recipient === d.recipientName) return NextResponse.json({ ok: true, unchanged: true });

    const undid = await prisma.$transaction(async (db) => {
      const undid = await revertAcceptance(db, d.id);
      await db.delivery.update({
        where: { id: d.id },
        data: { checklist: next as never, discrepancies: lines.length ? lines.join("\n") : null, driverName: driver, recipientName: recipient, editedAt: new Date(), editedByName: user.name },
      });
      await syncPoStatus(db, po.id);
      return undid;
    });
    const after = await prisma.purchaseOrder.findUnique({ where: { id: po.id }, select: { status: true } });
    await audit({
      entityType: "Delivery",
      entityId: d.id,
      actorId: user.id,
      actorName: user.name,
      action: "DELIVERY_EDITED",
      diff: {
        po: po.poNumber,
        project: label,
        reason: body.reason,
        changes,
        driverName: { from: d.driverName, to: driver },
        recipientName: { from: d.recipientName, to: recipient },
        discrepanciesNow: lines,
        completeNow: lines.length === 0,
        acceptanceTakenBack: undid,
        poStatus: { from: po.status, to: after?.status ?? po.status },
      } as never,
    });
    return NextResponse.json({ ok: true, complete: lines.length === 0, poStatus: after?.status });
  }

  // ---------------------------------------------------------------- accept
  if (body.action === "accept") {
    if (d.needsConfirmation && !d.confirmedAt) throw new ApiError(400, "This delivery is still waiting for the receiver's confirmation — it can be accepted once that is done");
    if (d.acceptedAt) throw new ApiError(409, "This delivery was already accepted");
    if (!d.discrepancies) throw new ApiError(400, "This delivery already tallies with the PO — there is nothing to accept");
    const poItems = (po.items as unknown as PoLine[]).map((i) => ({ name: i.name, qty: Number(i.qty), unit: i.unit, unitCost: Number(i.unitCost) }));
    const plan = planAdjustment(poItems, stored);
    if (body.expectedTotalAfter !== undefined && Math.abs(body.expectedTotalAfter - plan.totalAfter) > 0.005) {
      throw new ApiError(409, "The PO changed since you opened this — close the window and look again");
    }
    const reqItems = po.requisition.items.map((r) => ({ id: r.id, name: r.name, qty: Number(r.qty), estUnitCost: r.estUnitCost === null ? null : Number(r.estUnitCost) }));
    const reqPlan = adjustRequisitionItems(reqItems, plan.lines);
    const adjustment: StoredAdjustment = {
      poItemsBefore: poItems,
      poTotalBefore: plan.totalBefore,
      poTotalAfter: plan.totalAfter,
      lines: plan.lines,
      requisition: { items: reqPlan.items, estimatedBefore: po.requisition.estimatedCost === null ? null : Number(po.requisition.estimatedCost), estimatedAfter: reqPlan.estimatedAfter, unmatched: reqPlan.unmatched },
    };
    const now = new Date();
    await prisma.$transaction(async (db) => {
      const done = await db.delivery.updateMany({ where: { id: d.id, acceptedAt: null }, data: { acceptedAt: now, acceptedById: user.id, acceptedByName: user.name, acceptedNote: body.reason, adjustment: adjustment as never } });
      if (done.count === 0) throw new ApiError(409, "This delivery was just accepted by someone else");
      await db.purchaseOrder.update({ where: { id: po.id }, data: { items: plan.poItems as never, totalCost: plan.totalAfter, status: "DELIVERED" } });
      for (const i of reqPlan.items) await db.requisitionItem.update({ where: { id: i.id }, data: { qty: i.to } });
      if (!plan.unchanged) await db.requisition.update({ where: { id: po.requisitionId }, data: { estimatedCost: reqPlan.estimatedAfter } });
      await db.requisition.updateMany({ where: { id: po.requisitionId, status: "PO_ISSUED" }, data: { status: "DELIVERED" } });
    });
    await audit({
      entityType: "Delivery",
      entityId: d.id,
      actorId: user.id,
      actorName: user.name,
      action: "DELIVERY_ACCEPTED_BY_OWNER",
      diff: {
        po: po.poNumber,
        project: label,
        reason: body.reason,
        notTallied: d.discrepancies.split("\n"),
        poLines: plan.lines,
        committedCost: { from: plan.totalBefore, to: plan.totalAfter },
        requisitionItemsChanged: reqPlan.items.length,
        requisitionEstimate: { from: adjustment.requisition.estimatedBefore, to: reqPlan.estimatedAfter },
        notOnRequisition: reqPlan.unmatched,
      } as never,
    });
    return NextResponse.json({ ok: true, committedCost: { from: plan.totalBefore, to: plan.totalAfter } });
  }

  // ----------------------------------------------------------- undo_accept
  if (!d.acceptedAt) throw new ApiError(400, "This delivery was not accepted");
  const adj = d.adjustment as unknown as StoredAdjustment | null;
  await prisma.$transaction(async (db) => {
    await revertAcceptance(db, d.id);
    await syncPoStatus(db, po.id);
  });
  await audit({
    entityType: "Delivery",
    entityId: d.id,
    actorId: user.id,
    actorName: user.name,
    action: "DELIVERY_ACCEPTANCE_UNDONE",
    diff: { po: po.poNumber, project: label, reason: body.reason, committedCost: adj ? { from: adj.poTotalAfter, to: adj.poTotalBefore } : null, wasAcceptedFor: d.acceptedNote } as never,
  });
  return NextResponse.json({ ok: true });
});

/**
 * DELETE /api/deliveries/[id] — Owner-only, for correcting test/mistaken delivery verifications. Takes back an Owner acceptance
 * first (so the PO and requisition go back to what they were), recomputes the PO's status from whatever delivery events remain
 * (or reopens it if none do), and reverts the requisition off "DELIVERED" if this was the event that completed it.
 */
export const DELETE = handleApi(async (_req: NextRequest, { params }: { params: { id: string } }) => {
  const user = await requireUser(["OWNER"]);

  const delivery = await prisma.delivery.findUnique({ where: { id: params.id }, include: { po: true } });
  if (!delivery) throw new ApiError(404, "Delivery not found");

  await prisma.$transaction(async (db) => {
    await revertAcceptance(db, delivery.id);
    await db.delivery.delete({ where: { id: delivery.id } });
    await syncPoStatus(db, delivery.poId);
  });

  await audit({
    entityType: "Delivery",
    entityId: delivery.id,
    actorId: user.id,
    actorName: user.name,
    action: "DELIVERY_DELETED",
    diff: { po: delivery.po.poNumber, hadOwnerAcceptance: !!delivery.acceptedAt },
  });

  return NextResponse.json({ ok: true });
});
