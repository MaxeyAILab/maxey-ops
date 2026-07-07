import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { notifyOwner } from "@/lib/notify";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";

const respondSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
});

/**
 * POST /api/change-orders/[id]/respond — client approves/rejects in-portal.
 * Timestamped and attributed: this is the unambiguous record of client-caused
 * scope changes (Spec 6.8). Response is final — no overwrites.
 */
export const POST = handleApi(
  async (req: NextRequest, { params }: { params: { id: string } }) => {
    const user = await requireUser(["CLIENT", "OWNER"]);
    const body = respondSchema.parse(await req.json());

    const co = await prisma.changeOrder.findUnique({
      where: { id: params.id },
      include: { project: { include: { client: true } } },
    });
    if (!co) throw new ApiError(404, "Change order not found");

    // Clients can only act on their own project's change orders
    if (user.role === "CLIENT" && co.project.clientId !== user.clientId) {
      throw new ApiError(403, "Not your project");
    }
    if (co.status !== "PENDING_CLIENT") {
      throw new ApiError(400, `Change order already ${co.status.toLowerCase()}`);
    }

    const updated = await prisma.$transaction(async (db) => {
      const updated = await db.changeOrder.update({
        where: { id: params.id },
        data: {
          status: body.decision,
          clientResponseAt: new Date(),
          clientResponseById: user.id,
        },
      });
      // Approved change orders auto-post into project value/cashflow (Spec 6.8)
      if (body.decision === "APPROVED" && Number(co.costImpact) !== 0) {
        await db.project.update({
          where: { id: co.projectId },
          data: { contractValue: { increment: co.costImpact } },
        });
        await db.paymentTerm.create({
          data: {
            projectId: co.projectId,
            type: "PARTIAL",
            label: `Change order: ${co.title}`,
            amount: co.costImpact,
            status: "DUE",
            sortOrder: 99,
          },
        });
      }
      return updated;
    });

    await audit({
      entityType: "ChangeOrder",
      entityId: co.id,
      actorId: user.id,
      actorName: user.name,
      action: `CHANGE_ORDER_${body.decision}`,
      diff: { project: co.project.name, costImpact: co.costImpact.toString() },
    });
    await notifyOwner(
      `Change order ${body.decision.toLowerCase()}`,
      `${co.project.client.name} ${body.decision.toLowerCase()} "${co.title}" on ${co.project.name}`
    );

    return NextResponse.json(updated);
  }
);
