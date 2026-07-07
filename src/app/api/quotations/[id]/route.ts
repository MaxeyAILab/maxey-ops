import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";

const patchSchema = z.object({
  status: z.enum(["DRAFT", "SENT", "ACCEPTED", "REJECTED"]),
});

/** PATCH /api/quotations/[id] — mark sent/accepted/rejected; syncs the lead status. */
export const PATCH = handleApi(
  async (req: NextRequest, { params }: { params: { id: string } }) => {
    const user = await requireUser(["OWNER"]);
    const body = patchSchema.parse(await req.json());

    const quotation = await prisma.quotation.findUnique({ where: { id: params.id } });
    if (!quotation) throw new ApiError(404, "Quotation not found");

    const updated = await prisma.$transaction(async (db) => {
      const q = await db.quotation.update({
        where: { id: params.id },
        data: { status: body.status },
      });
      if (body.status === "SENT") {
        await db.lead.update({
          where: { id: q.leadId },
          data: { status: "QUOTATION_SENT" },
        });
      }
      return q;
    });

    await audit({
      entityType: "Quotation",
      entityId: quotation.id,
      actorId: user.id,
      actorName: user.name,
      action: "QUOTATION_STATUS_CHANGED",
      diff: { from: quotation.status, to: body.status },
    });

    return NextResponse.json(updated);
  }
);
