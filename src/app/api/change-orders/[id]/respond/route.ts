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
      // Conditional on the status still being PENDING_CLIENT, so two
      // simultaneous responses (double click, two tabs) can only win once —
      // the loser sees count 0 and never touches contract value.
      const claimed = await db.changeOrder.updateMany({
        where: { id: params.id, status: "PENDING_CLIENT" },
        data: {
          status: body.decision,
          clientResponseAt: new Date(),
          clientResponseById: user.id,
        },
      });
      if (claimed.count === 0) throw new ApiError(409, "This change order was already answered");
      const updated = await db.changeOrder.findUniqueOrThrow({ where: { id: params.id } });
      // Approved change orders auto-post into project value/cashflow (Spec 6.8). The
      // increment is atomic and its result is recorded on the change order, so there is
      // always a before/after record of exactly what this approval did to the contract.
      if (body.decision === "APPROVED") {
        if (Number(co.costImpact) !== 0) {
          const project = await db.project.update({
            where: { id: co.projectId },
            data: { contractValue: { increment: co.costImpact } },
            select: { contractValue: true },
          });
          // A credit (reduction) can't take the contract below zero — undo the whole approval if it would.
          if (Number(project.contractValue) < 0) {
            throw new ApiError(409, "This credit is larger than the contract value, so it can't be approved — ask the team to correct it");
          }
          await db.changeOrder.update({
            where: { id: co.id },
            data: {
              contractAfter: project.contractValue,
              contractBefore: project.contractValue.minus(co.costImpact),
              incorporatedAt: new Date(),
            },
          });
          // Additional cost becomes a billing term. A credit doesn't create a negative bill: the contract value
          // drops, and the billing-schedule check will flag that the schedule now exceeds the contract so the team
          // adjusts the terms deliberately.
          if (Number(co.costImpact) > 0) {
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
        } else {
          const project = await db.project.findUniqueOrThrow({ where: { id: co.projectId }, select: { contractValue: true } });
          await db.changeOrder.update({
            where: { id: co.id },
            data: { contractBefore: project.contractValue, contractAfter: project.contractValue, incorporatedAt: new Date() },
          });
        }
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
