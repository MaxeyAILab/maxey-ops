import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";

const patchSchema = z.object({
  status: z.enum([
    "NEW",
    "UNDER_REVIEW",
    "ESTIMATE_IN_PROGRESS",
    "QUOTATION_SENT",
    "WON",
    "LOST",
  ]),
});

/** PATCH /api/leads/[id] — move a lead through the pipeline. */
export const PATCH = handleApi(
  async (req: NextRequest, { params }: { params: { id: string } }) => {
    const user = await requireUser(["OWNER"]);
    const body = patchSchema.parse(await req.json());

    const lead = await prisma.lead.findUnique({ where: { id: params.id } });
    if (!lead) throw new ApiError(404, "Lead not found");

    const updated = await prisma.lead.update({
      where: { id: params.id },
      data: { status: body.status },
    });

    await audit({
      entityType: "Lead",
      entityId: lead.id,
      actorId: user.id,
      actorName: user.name,
      action: "LEAD_STATUS_CHANGED",
      diff: { from: lead.status, to: body.status },
    });

    return NextResponse.json(updated);
  }
);
