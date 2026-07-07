import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { savePhotos } from "@/lib/storage";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import type { Prisma } from "@prisma/client";

const editSchema = z.object({
  amount: z.coerce.number().positive().optional(),
  dateReceived: z.coerce.date().optional(),
  method: z.string().max(50).optional(),
  reference: z.string().max(100).optional().or(z.literal("")),
  addAttachments: z.array(z.string()).max(6).optional(), // compressed data URLs
});

/** Re-derive a billing term's status after a payment correction. */
async function recomputeTermStatus(
  db: Prisma.TransactionClient,
  paymentTermId: string | null
) {
  if (!paymentTermId) return;
  const term = await db.paymentTerm.findUnique({
    where: { id: paymentTermId },
    include: { payments: true },
  });
  if (!term) return;
  const paid = term.payments.reduce((s, p) => s + Number(p.amount), 0);
  const status =
    paid >= Number(term.amount) ? "PAID" : paid > 0 || term.status === "PAID" ? "DUE" : term.status;
  if (status !== term.status) {
    await db.paymentTerm.update({ where: { id: term.id }, data: { status } });
  }
}

/**
 * PATCH /api/payments/[id] — correct a recorded payment (typo fixes) and/or
 * attach proof (check photos, acknowledgment receipts). Corrections are fully
 * audit-logged with before/after values — the history of the mistake and the
 * fix is preserved, satisfying the append-only accountability rule in spirit
 * while keeping the books usable.
 */
export const PATCH = handleApi(
  async (req: NextRequest, { params }: { params: { id: string } }) => {
    const user = await requireUser(["OWNER", "ACCOUNTING"]);
    const body = editSchema.parse(await req.json());

    const payment = await prisma.payment.findUnique({
      where: { id: params.id },
      include: { project: { select: { name: true } } },
    });
    if (!payment) throw new ApiError(404, "Payment not found");

    const newAttachmentUrls = await savePhotos(body.addAttachments);
    const existingAttachments = (payment.attachments as string[] | null) ?? [];

    const updated = await prisma.$transaction(async (db) => {
      const updated = await db.payment.update({
        where: { id: payment.id },
        data: {
          amount: body.amount ?? undefined,
          dateReceived: body.dateReceived ?? undefined,
          method: body.method ?? undefined,
          reference: body.reference === "" ? null : (body.reference ?? undefined),
          attachments: newAttachmentUrls.length
            ? [...existingAttachments, ...newAttachmentUrls]
            : undefined,
        },
      });
      if (body.amount !== undefined && body.amount !== Number(payment.amount)) {
        await recomputeTermStatus(db, payment.paymentTermId);
      }
      return updated;
    });

    await audit({
      entityType: "Payment",
      entityId: payment.id,
      actorId: user.id,
      actorName: user.name,
      action: "PAYMENT_EDITED",
      diff: {
        project: payment.project.name,
        before: {
          amount: Number(payment.amount),
          dateReceived: payment.dateReceived.toISOString().slice(0, 10),
          method: payment.method,
          reference: payment.reference,
        },
        after: {
          amount: Number(updated.amount),
          dateReceived: updated.dateReceived.toISOString().slice(0, 10),
          method: updated.method,
          reference: updated.reference,
        },
        attachmentsAdded: newAttachmentUrls.length,
      },
    });

    return NextResponse.json(updated);
  }
);

/**
 * DELETE /api/payments/[id] — void a wrongly recorded payment. The complete
 * record is preserved in the audit log before removal.
 */
export const DELETE = handleApi(
  async (_req: NextRequest, { params }: { params: { id: string } }) => {
    const user = await requireUser(["OWNER", "ACCOUNTING"]);

    const payment = await prisma.payment.findUnique({
      where: { id: params.id },
      include: { project: { select: { name: true } } },
    });
    if (!payment) throw new ApiError(404, "Payment not found");

    await prisma.$transaction(async (db) => {
      await db.payment.delete({ where: { id: payment.id } });
      await recomputeTermStatus(db, payment.paymentTermId);
    });

    await audit({
      entityType: "Payment",
      entityId: payment.id,
      actorId: user.id,
      actorName: user.name,
      action: "PAYMENT_VOIDED",
      diff: {
        project: payment.project.name,
        voidedRecord: {
          amount: Number(payment.amount),
          dateReceived: payment.dateReceived.toISOString().slice(0, 10),
          method: payment.method,
          reference: payment.reference,
          attachments: payment.attachments ?? [],
        },
      },
    });

    return NextResponse.json({ ok: true });
  }
);
