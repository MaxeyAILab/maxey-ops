import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import { projectOrCategoryLabel } from "@/lib/requisitions";
import { canConfirmDelivery } from "@/lib/delivery-confirm";
import { syncPoStatus } from "@/lib/delivery-db";

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("confirm") }),
  z.object({ action: z.literal("dispute"), note: z.string().trim().min(5).max(500) }),
]);

/**
 * POST /api/deliveries/[id]/confirm — the second step of delivery verification. The person who received the delivery confirms
 * they received it (or reports a problem instead, which tells the office and leaves it unconfirmed). Only the named receiver can
 * (the Owner for anyone; the PM and Purchasing when the receiver is not in the app). Confirming is what makes the delivery fully
 * verified: the PO and requisition are updated then, not before.
 */
export const POST = handleApi(async (req: NextRequest, { params }: { params: { id: string } }) => {
  const user = await requireUser();
  const body = bodySchema.parse(await req.json());
  const d = await prisma.delivery.findUnique({ where: { id: params.id }, include: { po: { include: { requisition: { include: { project: true } } } } } });
  if (!d) throw new ApiError(404, "Delivery not found");
  if (!d.needsConfirmation || d.confirmedAt) throw new ApiError(409, "This delivery was already confirmed");
  if (!canConfirmDelivery(user, d)) throw new ApiError(403, "Only the person named as receiving this delivery can confirm it");
  if (d.po.status === "CANCELLED") throw new ApiError(400, "This PO was cancelled");
  const label = projectOrCategoryLabel(d.po.requisition);

  if (body.action === "dispute") {
    await prisma.delivery.update({ where: { id: d.id }, data: { disputedAt: new Date(), disputeNote: body.note } });
    await audit({
      entityType: "Delivery",
      entityId: d.id,
      actorId: user.id,
      actorName: user.name,
      action: "DELIVERY_DISPUTED",
      diff: { po: d.po.poNumber, project: label, note: body.note, driverName: d.driverName },
    });
    return NextResponse.json({ ok: true });
  }

  const now = new Date();
  await prisma.$transaction(async (db) => {
    const done = await db.delivery.updateMany({
      where: { id: d.id, confirmedAt: null },
      data: { confirmedAt: now, confirmedById: user.id, confirmedByName: user.name, disputedAt: null, disputeNote: null },
    });
    if (done.count === 0) throw new ApiError(409, "This delivery was just confirmed by someone else");
    await syncPoStatus(db, d.poId);
  });
  await audit({
    entityType: "Delivery",
    entityId: d.id,
    actorId: user.id,
    actorName: user.name,
    action: d.discrepancies ? "DELIVERY_VERIFIED_WITH_DISCREPANCIES" : "DELIVERY_VERIFIED",
    diff: { po: d.po.poNumber, project: label, confirmedBy: user.name, onBehalfOf: user.id === d.receiverId ? null : d.recipientName, discrepancies: d.discrepancies ? d.discrepancies.split("\n") : [] },
  });
  return NextResponse.json({ ok: true });
});
