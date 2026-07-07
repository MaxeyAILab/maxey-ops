import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";

const lineItemSchema = z.object({
  category: z.enum(["MATERIAL", "LABOR", "EQUIPMENT", "OTHER"]).default("MATERIAL"),
  description: z.string().min(1).max(500),
  qty: z.coerce.number().positive(),
  unit: z.string().min(1).max(30),
  unitPrice: z.coerce.number().min(0),
});

const createSchema = z.object({
  leadId: z.string().min(1),
  markupPct: z.coerce.number().min(0).max(100).default(15),
  vatPct: z.coerce.number().min(0).max(100).default(12),
  notes: z.string().max(2000).optional(),
  lineItems: z.array(lineItemSchema).min(1),
});

/** POST /api/quotations — create a quotation for a lead (Spec 6.1 estimate builder). */
export const POST = handleApi(async (req: NextRequest) => {
  const user = await requireUser(["OWNER"]);
  const body = createSchema.parse(await req.json());

  const lead = await prisma.lead.findUnique({ where: { id: body.leadId } });
  if (!lead) throw new ApiError(404, "Lead not found");

  const year = new Date().getFullYear();
  const count = await prisma.quotation.count();
  const number = `Q-${year}-${String(count + 1).padStart(4, "0")}`;

  const quotation = await prisma.$transaction(async (db) => {
    const q = await db.quotation.create({
      data: {
        number,
        leadId: body.leadId,
        markupPct: body.markupPct,
        vatPct: body.vatPct,
        notes: body.notes,
        createdById: user.id,
        validUntil: new Date(Date.now() + 30 * 86_400_000),
        lineItems: {
          create: body.lineItems.map((li, i) => ({ ...li, sortOrder: i })),
        },
      },
    });
    if (lead.status === "NEW" || lead.status === "UNDER_REVIEW") {
      await db.lead.update({
        where: { id: lead.id },
        data: { status: "ESTIMATE_IN_PROGRESS" },
      });
    }
    return q;
  });

  await audit({
    entityType: "Quotation",
    entityId: quotation.id,
    actorId: user.id,
    actorName: user.name,
    action: "QUOTATION_CREATED",
    diff: { number, leadId: body.leadId, items: body.lineItems.length },
  });

  return NextResponse.json(quotation, { status: 201 });
});
