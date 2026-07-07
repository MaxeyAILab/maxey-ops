import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { savePhotos } from "@/lib/storage";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";

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
});

/**
 * POST /api/deliveries — on-site delivery verification against the PO
 * (Spec 6.3), offline-capable. Auto-generates the Delivery Form, updates the
 * PO/requisition status, and flags discrepancies to PM + Purchasing.
 */
export const POST = handleApi(async (req: NextRequest) => {
  const user = await requireUser(["FOREMAN", "PM", "OWNER"]);
  const body = createSchema.parse(await req.json());

  const dup = await prisma.delivery.findUnique({ where: { clientUuid: body.clientUuid } });
  if (dup) return NextResponse.json({ error: "Already synced", id: dup.id }, { status: 409 });

  const po = await prisma.purchaseOrder.findUnique({
    where: { id: body.poId },
    include: { requisition: { include: { project: true } } },
  });
  if (!po) throw new ApiError(404, "Purchase order not found");
  if (po.status === "CANCELLED") throw new ApiError(400, "PO is cancelled");

  const discrepancyLines = body.checklist
    .filter((c) => !c.ok || c.receivedQty < c.orderedQty)
    .map(
      (c) =>
        `${c.item}: ordered ${c.orderedQty}, received ${c.receivedQty}${c.remarks ? ` — ${c.remarks}` : ""}`
    );
  const complete = discrepancyLines.length === 0;
  const photoUrls = await savePhotos(body.photos);

  const delivery = await prisma.$transaction(async (db) => {
    const delivery = await db.delivery.create({
      data: {
        clientUuid: body.clientUuid,
        poId: po.id,
        projectId: po.requisition.projectId,
        checklist: body.checklist as never,
        verifiedById: user.id,
        verifiedAt: body.submittedAt,
        discrepancies: complete ? null : discrepancyLines.join("\n"),
        photos: photoUrls.length ? photoUrls : undefined,
        gps: body.gps || null,
      },
    });
    await db.purchaseOrder.update({
      where: { id: po.id },
      data: { status: complete ? "DELIVERED" : "PARTIALLY_DELIVERED" },
    });
    if (complete) {
      await db.requisition.update({
        where: { id: po.requisitionId },
        data: { status: "DELIVERED" },
      });
    }
    return delivery;
  });

  await audit({
    entityType: "Delivery",
    entityId: delivery.id,
    actorId: user.id,
    actorName: user.name,
    action: complete ? "DELIVERY_VERIFIED" : "DELIVERY_VERIFIED_WITH_DISCREPANCIES",
    diff: {
      po: po.poNumber,
      project: po.requisition.project.name,
      discrepancies: discrepancyLines,
    },
  });

  if (!complete) {
    // Auto-flag to PM + Purchasing for supplier follow-up (Spec 6.3)
    await notify({
      to: { name: "PM & Purchasing" },
      subject: `Delivery discrepancy — ${po.poNumber}`,
      message: `${po.requisition.project.name}: ${discrepancyLines.join("; ")}`,
    });
  }

  return NextResponse.json(delivery, { status: 201 });
});
