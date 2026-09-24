import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";

const patchSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(5000),
  costImpact: z.coerce.number().default(0),
  timeImpactDays: z.coerce.number().int().default(0),
});

/**
 * PATCH /api/change-orders/[id] — Owner-only correction for a typo'd or
 * mistaken change order. Only while still PENDING_CLIENT: once the client
 * has responded it's a timestamped record (Spec 6.8's "response is final"),
 * and an APPROVED order may have already posted to contract value/cashflow.
 */
export const PATCH = handleApi(
  async (req: NextRequest, { params }: { params: { id: string } }) => {
    const user = await requireUser(["OWNER"]);
    const body = patchSchema.parse(await req.json());

    const co = await prisma.changeOrder.findUnique({
      where: { id: params.id },
      include: { project: { select: { name: true } } },
    });
    if (!co) throw new ApiError(404, "Change order not found");
    if (co.status !== "PENDING_CLIENT") {
      throw new ApiError(400, `Only pending change orders can be edited — this one is already ${co.status.toLowerCase()}`);
    }

    const updated = await prisma.changeOrder.update({
      where: { id: params.id },
      data: {
        title: body.title,
        description: body.description,
        costImpact: body.costImpact,
        timeImpactDays: body.timeImpactDays,
      },
    });

    await audit({
      entityType: "ChangeOrder",
      entityId: co.id,
      actorId: user.id,
      actorName: user.name,
      action: "CHANGE_ORDER_EDITED",
      diff: {
        project: co.project.name,
        from: { title: co.title, costImpact: co.costImpact.toString(), timeImpactDays: co.timeImpactDays },
        to: { title: body.title, costImpact: body.costImpact, timeImpactDays: body.timeImpactDays },
      },
    });

    return NextResponse.json(updated);
  }
);

/**
 * DELETE /api/change-orders/[id] — Owner-only cancel for a mistaken change
 * order, while it's still awaiting the client's response. Once responded to,
 * delete is blocked — same reasoning as PATCH above.
 */
export const DELETE = handleApi(
  async (_req: NextRequest, { params }: { params: { id: string } }) => {
    const user = await requireUser(["OWNER"]);

    const co = await prisma.changeOrder.findUnique({
      where: { id: params.id },
      include: { project: { select: { name: true } } },
    });
    if (!co) throw new ApiError(404, "Change order not found");
    if (co.status !== "PENDING_CLIENT") {
      throw new ApiError(400, `Only pending change orders can be deleted — this one is already ${co.status.toLowerCase()}`);
    }

    await prisma.changeOrder.delete({ where: { id: params.id } });

    await audit({
      entityType: "ChangeOrder",
      entityId: co.id,
      actorId: user.id,
      actorName: user.name,
      action: "CHANGE_ORDER_DELETED",
      diff: { project: co.project.name, title: co.title, costImpact: co.costImpact.toString() },
    });

    return NextResponse.json({ ok: true });
  }
);
