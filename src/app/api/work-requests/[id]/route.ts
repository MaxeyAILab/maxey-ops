import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import {
  canReviewWorkRequest,
  canWithdrawWorkRequest,
  formatWorkRequestNumber,
  validateConversion,
} from "@/lib/work-requests";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";

const patchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("acknowledge") }),
  z.object({
    action: z.literal("assess"),
    estimatedCost: z.coerce.number().min(-1_000_000_000).max(1_000_000_000).optional().nullable(),
    estimatedDays: z.coerce.number().int().min(0).max(3650).optional().nullable(),
    internalNote: z.string().max(2000).optional().nullable(),
  }),
  z.object({
    action: z.literal("convert"),
    costImpact: z.coerce.number().optional().nullable(),
    timeImpactDays: z.coerce.number().optional().nullable(),
    title: z.string().trim().min(3).max(200).optional(),
    description: z.string().trim().min(3).max(5000).optional(),
  }),
  z.object({ action: z.literal("decline"), reason: z.string().trim().min(5, "Give the client a reason of at least 5 characters").max(1000) }),
  z.object({ action: z.literal("withdraw") }),
]);

const OPEN = ["REQUESTED", "UNDER_REVIEW"] as const;

/**
 * PATCH /api/work-requests/[id]
 *  - acknowledge / assess / convert / decline: Owner and PM only.
 *  - withdraw: the project's own client, only while the request is still open.
 * Every status change is a conditional update on the status we expect, so two
 * people (or a double click) can only apply it once — which also means a
 * request can only ever become ONE change order.
 * Converting creates an ordinary PENDING_CLIENT change order; the contract
 * value only moves if the client later approves it, through the existing flow.
 */
export const PATCH = handleApi(async (req: NextRequest, { params }: { params: { id: string } }) => {
  const user = await requireUser(["OWNER", "PM", "CLIENT"]);
  const body = patchSchema.parse(await req.json());

  const wr = await prisma.workRequest.findUnique({
    where: { id: params.id },
    include: { project: { select: { id: true, name: true, clientId: true, client: { select: { name: true, email: true, phone: true } } } } },
  });
  if (!wr) throw new ApiError(404, "Request not found");
  const label = formatWorkRequestNumber(wr.number);

  // ----- client: withdraw -----
  if (user.role === "CLIENT") {
    if (user.clientId !== wr.project.clientId) throw new ApiError(404, "Request not found");
    if (body.action !== "withdraw") throw new ApiError(403, "Not authorized for this action");
    if (!canWithdrawWorkRequest(wr, { id: user.id, role: user.role, clientId: user.clientId }, wr.project.clientId)) {
      throw new ApiError(409, "This request has already been handled, so it can't be withdrawn");
    }
    const res = await prisma.workRequest.updateMany({
      where: { id: wr.id, source: "PORTAL", status: { in: [...OPEN] } },
      data: { status: "WITHDRAWN", withdrawnAt: new Date() },
    });
    if (res.count === 0) throw new ApiError(409, "This request was just handled by the team — refresh the page");
    await audit({ entityType: "WorkRequest", entityId: wr.id, actorId: user.id, actorName: user.name, action: "WORK_REQUEST_WITHDRAWN", diff: { project: wr.project.name, number: label } });
    return NextResponse.json({ ok: true });
  }

  // ----- staff -----
  if (!canReviewWorkRequest(user.role) || body.action === "withdraw") throw new ApiError(403, "Not authorized for this action");
  const staffName = user.name;

  if (body.action === "acknowledge") {
    const res = await prisma.workRequest.updateMany({
      where: { id: wr.id, status: "REQUESTED" },
      data: { status: "UNDER_REVIEW", reviewedById: user.id, reviewedByName: staffName, reviewedAt: new Date() },
    });
    if (res.count === 0) throw new ApiError(409, "This request is no longer waiting for review — refresh the page");
    await audit({ entityType: "WorkRequest", entityId: wr.id, actorId: user.id, actorName: staffName, action: "WORK_REQUEST_ACKNOWLEDGED", diff: { project: wr.project.name, number: label } });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "assess") {
    const res = await prisma.workRequest.updateMany({
      where: { id: wr.id, status: { in: [...OPEN] } },
      data: {
        status: "UNDER_REVIEW",
        reviewedById: user.id,
        reviewedByName: staffName,
        reviewedAt: new Date(),
        ...(body.estimatedCost !== undefined ? { estimatedCost: body.estimatedCost } : {}),
        ...(body.estimatedDays !== undefined ? { estimatedDays: body.estimatedDays } : {}),
        ...(body.internalNote !== undefined ? { internalNote: body.internalNote || null } : {}),
      },
    });
    if (res.count === 0) throw new ApiError(409, "This request has already been handled — refresh the page");
    await audit({
      entityType: "WorkRequest",
      entityId: wr.id,
      actorId: user.id,
      actorName: staffName,
      action: "WORK_REQUEST_ASSESSED",
      diff: { project: wr.project.name, number: label, estimatedCost: body.estimatedCost ?? null, estimatedDays: body.estimatedDays ?? null },
    });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "decline") {
    const res = await prisma.workRequest.updateMany({
      where: { id: wr.id, status: { in: [...OPEN] } },
      data: { status: "DECLINED", declineReason: body.reason, reviewedById: user.id, reviewedByName: staffName, reviewedAt: new Date() },
    });
    if (res.count === 0) throw new ApiError(409, "This request has already been handled — refresh the page");
    await audit({ entityType: "WorkRequest", entityId: wr.id, actorId: user.id, actorName: staffName, action: "WORK_REQUEST_DECLINED", diff: { project: wr.project.name, number: label, reason: body.reason } });
    return NextResponse.json({ ok: true });
  }

  // ----- convert to a change order -----
  const problem = validateConversion({ costImpact: body.costImpact, timeImpactDays: body.timeImpactDays }, wr.kind);
  if (problem) throw new ApiError(400, problem);
  const costImpact = body.costImpact as number;
  const timeImpactDays = body.timeImpactDays as number;

  const co = await prisma.$transaction(async (db) => {
    const claimed = await db.workRequest.updateMany({
      where: { id: wr.id, status: { in: [...OPEN] } },
      data: {
        status: "CONVERTED",
        estimatedCost: costImpact,
        estimatedDays: timeImpactDays,
        reviewedById: user.id,
        reviewedByName: staffName,
        reviewedAt: new Date(),
      },
    });
    if (claimed.count === 0) throw new ApiError(409, "This request has already been handled — refresh the page");
    const created = await db.changeOrder.create({
      data: {
        projectId: wr.projectId,
        title: body.title ?? wr.title,
        description: body.description ?? wr.description,
        costImpact,
        timeImpactDays,
        photos: wr.photos === null ? undefined : (wr.photos as Prisma.InputJsonValue),
        createdById: user.id,
      },
    });
    await db.workRequest.update({ where: { id: wr.id }, data: { changeOrderId: created.id } });
    return created;
  });

  await audit({
    entityType: "WorkRequest",
    entityId: wr.id,
    actorId: user.id,
    actorName: staffName,
    action: "WORK_REQUEST_CONVERTED",
    diff: { project: wr.project.name, number: label, changeOrderId: co.id, costImpact, timeImpactDays },
  });
  await audit({
    entityType: "ChangeOrder",
    entityId: co.id,
    actorId: user.id,
    actorName: staffName,
    action: "CHANGE_ORDER_CREATED",
    diff: { project: wr.project.name, costImpact, days: timeImpactDays, fromWorkRequest: label },
  });
  await notify({
    to: { name: wr.project.client.name, email: wr.project.client.email, phone: wr.project.client.phone },
    subject: "Quotation awaiting your approval",
    message: `${co.title} — please review it in your Maxey Construction client portal.`,
  });

  return NextResponse.json({ ok: true, changeOrderId: co.id });
});
