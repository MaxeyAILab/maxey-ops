import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { notifyOwner } from "@/lib/notify";
import { handleApi, requireUser } from "@/lib/rbac";

const ESTIMATE_TURNAROUND_DAYS = 5; // configurable auto-reply promise (Spec 6.1)

const createLeadSchema = z.object({
  contactName: z.string().min(1).max(200),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().max(30).optional().or(z.literal("")),
  address: z.string().max(500).optional().or(z.literal("")),
  message: z.string().max(5000).optional().or(z.literal("")),
  source: z
    .enum(["WEBSITE", "FACEBOOK", "REFERRAL", "WALK_IN", "GOVERNMENT_BID", "OTHER"])
    .default("WEBSITE"),
});

/**
 * POST /api/leads — public lead intake (website contact form; the Facebook
 * webhook will post here too in Phase 3). Creates the Lead record
 * automatically so no one has to watch an inbox live.
 */
export const POST = handleApi(async (req: NextRequest) => {
  const body = createLeadSchema.parse(await req.json());
  const dueBy = new Date(Date.now() + ESTIMATE_TURNAROUND_DAYS * 86_400_000);

  const lead = await prisma.lead.create({
    data: {
      contactName: body.contactName,
      email: body.email || null,
      phone: body.phone || null,
      address: body.address || null,
      message: body.message || null,
      source: body.source,
      estimateDueBy: dueBy,
    },
  });

  await audit({
    entityType: "Lead",
    entityId: lead.id,
    actorName: body.contactName,
    action: "LEAD_CREATED",
    diff: { source: body.source },
  });
  await notifyOwner(
    "New inquiry received",
    `${body.contactName} (${body.source}) — estimate due by ${dueBy.toDateString()}`
  );

  return NextResponse.json(
    {
      ok: true,
      message: `Thank you! Your inquiry has been received. Expect our estimate within ${ESTIMATE_TURNAROUND_DAYS} business days.`,
    },
    { status: 201 }
  );
});

/** GET /api/leads — Owner-only (Leads menu is Owner-only). */
export const GET = handleApi(async () => {
  await requireUser(["OWNER"]);
  const leads = await prisma.lead.findMany({
    orderBy: { createdAt: "asc" },
    include: { quotations: { select: { id: true, number: true, status: true } } },
  });
  return NextResponse.json(leads);
});
