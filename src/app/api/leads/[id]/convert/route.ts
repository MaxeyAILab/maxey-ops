import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";

const convertSchema = z.object({
  projectName: z.string().min(1).max(200),
  contractValue: z.coerce.number().min(0),
  address: z.string().max(500).optional(),
  downpaymentPct: z.coerce.number().min(0).max(100).default(30),
  retentionPct: z.coerce.number().min(0).max(100).default(10),
});

/**
 * POST /api/leads/[id]/convert — convert a won lead into a Client + Project,
 * carrying over contact info (Spec 6.1). Seeds standard payment terms
 * (downpayment / progress billing / retention) from the given percentages.
 */
export const POST = handleApi(
  async (req: NextRequest, { params }: { params: { id: string } }) => {
    const user = await requireUser(["OWNER"]);
    const body = convertSchema.parse(await req.json());

    const lead = await prisma.lead.findUnique({ where: { id: params.id } });
    if (!lead) throw new ApiError(404, "Lead not found");
    if (lead.status === "LOST") throw new ApiError(400, "Cannot convert a lost lead");

    const dp = (body.contractValue * body.downpaymentPct) / 100;
    const retention = (body.contractValue * body.retentionPct) / 100;
    const progress = Math.max(body.contractValue - dp - retention, 0);

    const project = await prisma.$transaction(async (db) => {
      const client =
        lead.clientId != null
          ? await db.client.findUniqueOrThrow({ where: { id: lead.clientId } })
          : await db.client.create({
              data: {
                name: lead.contactName,
                contactName: lead.contactName,
                email: lead.email,
                phone: lead.phone,
                address: lead.address,
                source: lead.source,
              },
            });

      const project = await db.project.create({
        data: {
          clientId: client.id,
          leadId: lead.id,
          name: body.projectName,
          address: body.address ?? lead.address,
          contractValue: body.contractValue,
          status: "SITE_SURVEY",
          paymentTerms: {
            create: [
              {
                type: "DOWNPAYMENT",
                label: `Downpayment (${body.downpaymentPct}%)`,
                amount: dp,
                status: "DUE",
                sortOrder: 0,
              },
              {
                type: "PARTIAL",
                label: "Progress billing",
                amount: progress,
                sortOrder: 1,
              },
              {
                type: "RETENTION",
                label: `Retention (${body.retentionPct}%)`,
                amount: retention,
                dueCondition: "Released after acceptance / defects liability period",
                sortOrder: 2,
              },
            ],
          },
        },
      });

      await db.lead.update({
        where: { id: lead.id },
        data: { status: "WON", clientId: client.id },
      });
      return project;
    });

    await audit({
      entityType: "Project",
      entityId: project.id,
      actorId: user.id,
      actorName: user.name,
      action: "PROJECT_CREATED_FROM_LEAD",
      diff: { leadId: lead.id, contractValue: body.contractValue },
    });

    return NextResponse.json(project, { status: 201 });
  }
);
