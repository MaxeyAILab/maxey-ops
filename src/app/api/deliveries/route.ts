import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { savePhotos } from "@/lib/storage";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import { projectOrCategoryLabel } from "@/lib/requisitions";
import { canVerifyDelivery } from "@/lib/access";
import { discrepancyLines as listDiscrepancies } from "@/lib/delivery-adjust";
import { missingNames } from "@/lib/delivery-confirm";
import { syncPoStatus } from "@/lib/delivery-db";

const checkItemSchema = z.object({
  item: z.string().min(1),
  orderedQty: z.coerce.number(),
  receivedQty: z.coerce.number().min(0),
  ok: z.boolean(),
  remarks: z.string().max(500).optional().or(z.literal("")),
});

const createSchema = z.object({
  clientUuid: z.string().uuid(),
  submittedAt: z.coerce.date(),
  poId: z.string().min(1),
  checklist: z.array(checkItemSchema).min(1),
  gps: z.string().max(100).optional().or(z.literal("")),
  photos: z.array(z.string()).max(6).optional(), // compressed data URLs
  driverName: z.string().max(200).optional().or(z.literal("")),
  /** the staff member receiving the delivery — they confirm it afterwards */
  receiverId: z.string().optional().or(z.literal("")),
  /** the receiver's name when they are not in the app (office confirms for them) */
  recipientName: z.string().max(200).optional().or(z.literal("")),
});

/**
 * POST /api/deliveries — on-site delivery verification against the PO (Spec 6.3), offline-capable. The driver's name and the
 * receiver's name are both required. The delivery is first verified by whoever checked the count (usually the driver); it is
 * only FULLY verified when the person receiving it confirms (POST /api/deliveries/[id]/confirm) — until then the PO and
 * requisition do not change. When the person verifying is also the receiver, it is confirmed at once. Discrepancies are flagged
 * to PM + Purchasing.
 */
export const POST = handleApi(async (req: NextRequest) => {
  const user = await requireUser();
  if (!canVerifyDelivery(user.role, user.department)) {
    throw new ApiError(403, "Not authorized for this action");
  }
  const body = createSchema.parse(await req.json());
  const driverName = (body.driverName ?? "").trim();
  const receiverId = body.receiverId || null;
  const missing = missingNames({ driverName, receiverId, recipientName: body.recipientName });
  if (missing) throw new ApiError(400, missing);

  const dup = await prisma.delivery.findUnique({ where: { clientUuid: body.clientUuid } });
  if (dup) return NextResponse.json({ error: "Already synced", id: dup.id }, { status: 409 });

  let recipientName = (body.recipientName ?? "").trim();
  if (receiverId) {
    const receiver = await prisma.user.findUnique({ where: { id: receiverId }, select: { name: true, active: true, role: true } });
    if (!receiver || !receiver.active || receiver.role === "CLIENT") throw new ApiError(400, "Choose the receiver from the list of staff");
    recipientName = receiver.name;
  }

  const po = await prisma.purchaseOrder.findUnique({
    where: { id: body.poId },
    include: { requisition: { include: { project: true } } },
  });
  if (!po) throw new ApiError(404, "Purchase order not found");
  if (po.status === "CANCELLED") throw new ApiError(400, "PO is cancelled");

  const waiting = await prisma.delivery.findFirst({ where: { poId: po.id, needsConfirmation: true, confirmedAt: null }, select: { recipientName: true } });
  if (waiting) throw new ApiError(400, `A delivery for ${po.poNumber} is already waiting for ${waiting.recipientName ?? "the receiver"} to confirm it`);

  const discrepancyLines = listDiscrepancies(body.checklist);
  const complete = discrepancyLines.length === 0;
  const photoUrls = await savePhotos(body.photos);
  const receivedByVerifier = !!receiverId && receiverId === user.id; // verifying and receiving it yourself: nothing more to confirm
  const now = new Date();

  const delivery = await prisma.$transaction(async (db) => {
    const delivery = await db.delivery.create({
      data: {
        clientUuid: body.clientUuid,
        poId: po.id,
        projectId: po.requisition.projectId,
        checklist: body.checklist as never,
        driverName,
        recipientName,
        verifiedById: user.id,
        verifiedAt: body.submittedAt,
        discrepancies: complete ? null : discrepancyLines.join("\n"),
        photos: photoUrls.length ? photoUrls : undefined,
        gps: body.gps || null,
        needsConfirmation: true,
        receiverId,
        ...(receivedByVerifier ? { confirmedAt: now, confirmedById: user.id, confirmedByName: user.name } : {}),
      },
    });
    if (receivedByVerifier) await syncPoStatus(db, po.id);
    return delivery;
  });

  await audit({
    entityType: "Delivery",
    entityId: delivery.id,
    actorId: user.id,
    actorName: user.name,
    action: receivedByVerifier ? (complete ? "DELIVERY_VERIFIED" : "DELIVERY_VERIFIED_WITH_DISCREPANCIES") : "DELIVERY_AWAITING_CONFIRMATION",
    diff: {
      po: po.poNumber,
      project: projectOrCategoryLabel(po.requisition),
      discrepancies: discrepancyLines,
      driverName,
      recipientName,
      waitingForReceiver: !receivedByVerifier,
    },
  });

  if (!complete) {
    // Auto-flag to PM + Purchasing for supplier follow-up (Spec 6.3)
    await notify({
      to: { name: "PM & Purchasing" },
      subject: `Delivery discrepancy — ${po.poNumber}`,
      message: `${projectOrCategoryLabel(po.requisition)}: ${discrepancyLines.join("; ")}`,
    });
  }

  return NextResponse.json(delivery, { status: 201 });
});
