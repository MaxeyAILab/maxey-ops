import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { savePhotos } from "@/lib/storage";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";

const createSchema = z.object({
  projectId: z.string().min(1),
  paymentTermId: z.string().optional(),
  amount: z.coerce.number().positive(),
  dateReceived: z.coerce.date(),
  method: z.string().max(50).optional(),
  reference: z.string().max(100).optional(),
  attachments: z.array(z.string()).max(6).optional(), // check photos / ARs / receipts
  clientUuid: z.string().uuid().optional(), // one per form submit: a double click or retry records once
});

/**
 * POST /api/payments — record a client payment (Accounting/Owner).
 * Financial entries are append-only (Spec §4): corrections are new entries,
 * never edits.
 */
export const POST = handleApi(async (req: NextRequest) => {
  const user = await requireUser(["ACCOUNTING", "OWNER"]);
  const body = createSchema.parse(await req.json());

  const project = await prisma.project.findUnique({ where: { id: body.projectId } });
  if (!project) throw new ApiError(404, "Project not found");

  // A retry of the same submit returns the payment already recorded instead of adding a second one.
  if (body.clientUuid) {
    const existing = await prisma.payment.findUnique({ where: { clientUuid: body.clientUuid } });
    if (existing) return NextResponse.json(existing, { status: 200 });
  }
  // The billing term must belong to this project — otherwise a payment could be booked against
  // (and mark as paid) another project's term.
  if (body.paymentTermId) {
    const term = await prisma.paymentTerm.findUnique({ where: { id: body.paymentTermId }, select: { projectId: true } });
    if (!term || term.projectId !== body.projectId) throw new ApiError(400, "That billing term isn't part of this project");
  }

  const attachmentUrls = await savePhotos(body.attachments);
  let payment;
  try {
    payment = await prisma.$transaction(async (db) => {
    const payment = await db.payment.create({
      data: {
        projectId: body.projectId,
        paymentTermId: body.paymentTermId || null,
        amount: body.amount,
        dateReceived: body.dateReceived,
        method: body.method,
        reference: body.reference,
        attachments: attachmentUrls.length ? attachmentUrls : undefined,
        clientUuid: body.clientUuid,
        recordedById: user.id,
      },
    });

    if (body.paymentTermId) {
      const term = await db.paymentTerm.findUnique({
        where: { id: body.paymentTermId },
        include: { payments: true },
      });
      if (term) {
        const paid = term.payments.reduce((s, p) => s + Number(p.amount), 0);
        if (paid >= Number(term.amount)) {
          await db.paymentTerm.update({ where: { id: term.id }, data: { status: "PAID" } });
        }
      }
    }
    return payment;
    });
  } catch (err) {
    // Two identical submits racing past the check above: the unique key lets exactly one through,
    // and the other gets the payment that was recorded rather than an error.
    if (body.clientUuid && err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const existing = await prisma.payment.findUnique({ where: { clientUuid: body.clientUuid } });
      if (existing) return NextResponse.json(existing, { status: 200 });
    }
    throw err;
  }

  await audit({
    entityType: "Payment",
    entityId: payment.id,
    actorId: user.id,
    actorName: user.name,
    action: "PAYMENT_RECORDED",
    diff: { project: project.name, amount: body.amount, method: body.method ?? null },
  });

  return NextResponse.json(payment, { status: 201 });
});
