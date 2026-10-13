import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { canSendChangeOrder, canWithdrawChangeOrder, validateSend } from "@/lib/change-orders";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";

const patchSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(5000),
  costImpact: z.coerce.number().default(0),
  timeImpactDays: z.coerce.number().int().default(0),
});

const lifecycleSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("send"),
    costImpact: z.coerce.number().optional().nullable(),
    timeImpactDays: z.coerce.number().optional().nullable(),
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().min(1).max(5000).optional(),
  }),
  z.object({ action: z.literal("withdraw"), reason: z.string().trim().min(5, "Give a reason of at least 5 characters").max(1000) }),
  z.object({
    action: z.literal("update_potential"),
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(5000),
    estimatedCost: z.coerce.number().min(0).optional().nullable(),
    timeImpactDays: z.coerce.number().int().min(0).optional().default(0),
    reason: z.string().max(2000).optional().nullable(),
  }),
]);

/**
 * Lifecycle actions (Owner or PM): send a potential change to the client, withdraw one that
 * is still open, or edit a potential one. Every status move is a conditional update on the
 * status we expect, so a double click or two people can only apply it once. Sending needs an
 * explicit price and time — a blank is never turned into zero. A change order the client has
 * already decided on can't be withdrawn: it is a timestamped record.
 */
async function lifecycle(req: NextRequest, id: string, raw: unknown) {
  const user = await requireUser(["OWNER", "PM"]);
  const body = lifecycleSchema.parse(raw);
  const co = await prisma.changeOrder.findUnique({
    where: { id },
    include: { project: { select: { name: true, client: { select: { name: true, email: true, phone: true } } } } },
  });
  if (!co) throw new ApiError(404, "Change order not found");

  if (body.action === "send") {
    if (!canSendChangeOrder(co.status)) throw new ApiError(409, "Only a potential change can be sent to the client");
    const problem = validateSend({ costImpact: body.costImpact, timeImpactDays: body.timeImpactDays });
    if (problem) throw new ApiError(400, problem);
    const res = await prisma.changeOrder.updateMany({
      where: { id, status: "POTENTIAL" },
      data: {
        status: "PENDING_CLIENT",
        costImpact: body.costImpact as number,
        timeImpactDays: body.timeImpactDays as number,
        ...(body.title ? { title: body.title } : {}),
        ...(body.description ? { description: body.description } : {}),
      },
    });
    if (res.count === 0) throw new ApiError(409, "This change order was just changed — refresh the page");
    await audit({ entityType: "ChangeOrder", entityId: id, actorId: user.id, actorName: user.name, action: "CHANGE_ORDER_SENT", diff: { project: co.project.name, costImpact: body.costImpact, days: body.timeImpactDays } });
    await notify({
      to: { name: co.project.client.name, email: co.project.client.email, phone: co.project.client.phone },
      subject: "Change order awaiting your approval",
      message: `${body.title ?? co.title} — please review it in your Maxey Construction client portal.`,
    });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "withdraw") {
    if (!canWithdrawChangeOrder(co.status)) throw new ApiError(409, `This change order is already ${co.status.toLowerCase().replace("_", " ")} and can't be withdrawn`);
    const res = await prisma.changeOrder.updateMany({
      where: { id, status: { in: ["POTENTIAL", "PENDING_CLIENT"] } },
      data: { status: "WITHDRAWN", withdrawnAt: new Date(), withdrawnReason: body.reason, withdrawnById: user.id },
    });
    if (res.count === 0) throw new ApiError(409, "The client just responded to this change order — refresh the page");
    await audit({ entityType: "ChangeOrder", entityId: id, actorId: user.id, actorName: user.name, action: "CHANGE_ORDER_WITHDRAWN", diff: { project: co.project.name, title: co.title, from: co.status, reason: body.reason } });
    return NextResponse.json({ ok: true });
  }

  // update_potential
  if (co.status !== "POTENTIAL") throw new ApiError(409, "Only a potential change can be edited here");
  const res = await prisma.changeOrder.updateMany({
    where: { id, status: "POTENTIAL" },
    data: { title: body.title, description: body.description, estimatedCost: body.estimatedCost ?? null, timeImpactDays: body.timeImpactDays, reason: body.reason || null },
  });
  if (res.count === 0) throw new ApiError(409, "This change order was just changed — refresh the page");
  await audit({ entityType: "ChangeOrder", entityId: id, actorId: user.id, actorName: user.name, action: "CHANGE_ORDER_POTENTIAL_EDITED", diff: { project: co.project.name, from: { title: co.title, estimatedCost: co.estimatedCost?.toString() ?? null }, to: { title: body.title, estimatedCost: body.estimatedCost ?? null } } });
  return NextResponse.json({ ok: true });
}

/**
 * PATCH /api/change-orders/[id] — Owner-only correction for a typo'd or
 * mistaken change order. Only while still PENDING_CLIENT: once the client
 * has responded it's a timestamped record (Spec 6.8's "response is final"),
 * and an APPROVED order may have already posted to contract value/cashflow.
 */
export const PATCH = handleApi(
  async (req: NextRequest, { params }: { params: { id: string } }) => {
    const raw = await req.json();
    // Lifecycle actions carry an "action" key; the original edit form doesn't, so it keeps working as before.
    if (raw && typeof raw === "object" && "action" in raw) return lifecycle(req, params.id, raw);
    const user = await requireUser(["OWNER"]);
    const body = patchSchema.parse(raw);

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
