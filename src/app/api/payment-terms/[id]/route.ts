import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { parseDates } from "@/lib/date-input";
import { dayIndex } from "@/lib/milestones";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";

const schema = z.object({
  invoiceNo: z.string().trim().max(60).optional().nullable(),
  invoicedAt: z.string().optional().nullable(),
  certifiedAt: z.string().optional().nullable(),
  dueDate: z.string().optional().nullable(),
  retentionReleaseDate: z.string().optional().nullable(),
});

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/**
 * PATCH /api/payment-terms/[id] — Owner or Accounting records the billing details of a term:
 * invoice number and date, the client's certification, the payment due date and (for
 * retention) the release date. All optional; clearing a field is allowed. Lateness is only
 * ever measured from a due date entered here, and an invoice is never treated as cash — only
 * recorded payments change what is owed. Issuing an invoice moves a not-yet-billed term to Due.
 */
export const PATCH = handleApi(async (req: NextRequest, { params }: { params: { id: string } }) => {
  const user = await requireUser(["OWNER", "ACCOUNTING"]);
  const body = schema.parse(await req.json());

  const term = await prisma.paymentTerm.findUnique({ where: { id: params.id }, include: { project: { select: { name: true } } } });
  if (!term) throw new ApiError(404, "Billing term not found");

  const has = (k: keyof typeof body) => body[k] !== undefined;
  const dates = parseDates(body, ["invoicedAt", "certifiedAt", "dueDate", "retentionReleaseDate"]);
  const invoicedAt = has("invoicedAt") ? dates.invoicedAt : term.invoicedAt;
  const certifiedAt = has("certifiedAt") ? dates.certifiedAt : term.certifiedAt;
  const dueDate = has("dueDate") ? dates.dueDate : term.dueDate;
  const retentionReleaseDate = has("retentionReleaseDate") ? dates.retentionReleaseDate : term.retentionReleaseDate;

  if (certifiedAt && !invoicedAt) throw new ApiError(400, "Certification follows an invoice — enter the invoice date first");
  if (invoicedAt && certifiedAt && dayIndex(certifiedAt)! < dayIndex(invoicedAt)!) throw new ApiError(400, "The certification date can't be before the invoice date");
  if (invoicedAt && dueDate && dayIndex(dueDate)! < dayIndex(invoicedAt)!) throw new ApiError(400, "The due date can't be before the invoice date");
  if (retentionReleaseDate && term.type !== "RETENTION") throw new ApiError(400, "A release date only applies to a retention term");

  const updated = await prisma.paymentTerm.update({
    where: { id: term.id },
    data: {
      ...(has("invoiceNo") ? { invoiceNo: body.invoiceNo || null } : {}),
      invoicedAt,
      certifiedAt,
      dueDate,
      retentionReleaseDate,
      ...(invoicedAt && term.status === "PENDING" ? { status: "DUE" as const } : {}),
    },
  });

  await audit({
    entityType: "PaymentTerm",
    entityId: term.id,
    actorId: user.id,
    actorName: user.name,
    action: "BILLING_DETAILS_UPDATED",
    diff: {
      project: term.project.name,
      term: term.label,
      from: { invoiceNo: term.invoiceNo, invoicedAt: iso(term.invoicedAt), certifiedAt: iso(term.certifiedAt), dueDate: iso(term.dueDate), retentionReleaseDate: iso(term.retentionReleaseDate), status: term.status },
      to: { invoiceNo: updated.invoiceNo, invoicedAt: iso(updated.invoicedAt), certifiedAt: iso(updated.certifiedAt), dueDate: iso(updated.dueDate), retentionReleaseDate: iso(updated.retentionReleaseDate), status: updated.status },
    },
  });

  return NextResponse.json(updated);
});
