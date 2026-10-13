import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { notifyOwner } from "@/lib/notify";
import { savePhotos } from "@/lib/storage";
import { parseDates } from "@/lib/date-input";
import { canCancelRfi, canCloseRfi, canManageRfi, canRespondToRfi, formatRfiNumber } from "@/lib/rfi";
import { assertActiveStaff, assertLinksBelongToProject } from "@/lib/rfi-links";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";

const impact = z.enum(["UNKNOWN", "NONE_IDENTIFIED", "POSSIBLE", "ASSESSED"]);

const patchSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("respond"),
    responseText: z.string().trim().min(2).max(5000),
    responsePhotos: z.array(z.string()).max(4).optional(),
    costImpact: impact.optional(),
    scheduleImpact: impact.optional(),
    scheduleImpactDays: z.coerce.number().int().min(-365).max(3650).optional().nullable(),
    impactNote: z.string().max(1000).optional().nullable(),
  }),
  z.object({ action: z.literal("close") }),
  z.object({ action: z.literal("reopen") }),
  z.object({ action: z.literal("cancel") }),
  z.object({
    action: z.literal("update"),
    assigneeId: z.string().optional().nullable(),
    dueDate: z.string().optional().nullable(),
    workItem: z.string().max(200).optional().nullable(),
    dailyReportNo: z.string().max(40).optional().nullable(),
    milestoneId: z.string().optional().nullable(),
    siteInstructionId: z.string().optional().nullable(),
    changeOrderId: z.string().optional().nullable(),
    documentId: z.string().optional().nullable(),
    costImpact: impact.optional(),
    scheduleImpact: impact.optional(),
    scheduleImpactDays: z.coerce.number().int().min(-365).max(3650).optional().nullable(),
    impactNote: z.string().max(1000).optional().nullable(),
  }),
]);

/**
 * PATCH /api/rfis/[id] — answer, close, reopen, cancel or update an RFI.
 * Every status change is a conditional update on the status we expect, so a
 * double click or two people acting at once can only succeed once. Impact
 * fields (cost / schedule) can only be set by the PM or Owner, and a client's
 * answer never carries them.
 */
export const PATCH = handleApi(async (req: NextRequest, { params }: { params: { id: string } }) => {
  const user = await requireUser(); // any signed-in role; each action checks its own rules
  const body = patchSchema.parse(await req.json());

  const rfi = await prisma.rfi.findUnique({
    where: { id: params.id },
    include: { project: { select: { id: true, name: true, clientId: true } } },
  });
  if (!rfi) throw new ApiError(404, "RFI not found");
  // A client can only ever touch RFIs addressed to them on their own projects.
  if (user.role === "CLIENT" && (rfi.addressedTo !== "CLIENT" || user.clientId !== rfi.project.clientId)) {
    throw new ApiError(404, "RFI not found");
  }
  const label = formatRfiNumber(rfi.number);
  const actor = { id: user.id, role: user.role, clientId: user.clientId };
  const isApprover = canManageRfi(actor);

  if (body.action === "respond") {
    const verdict = canRespondToRfi(rfi, actor, rfi.project.clientId);
    if (!verdict.ok) throw new ApiError(403, verdict.reason);
    const photos = await savePhotos(body.responsePhotos);
    const res = await prisma.rfi.updateMany({
      where: { id: rfi.id, status: "OPEN" },
      data: {
        status: "ANSWERED",
        responseText: body.responseText,
        responsePhotos: photos.length ? photos : undefined,
        respondedById: user.id,
        respondedByName: verdict.onBehalfOfClient ? `${user.name} (recorded for the client)` : user.name,
        respondedAt: new Date(),
        ...(isApprover
          ? {
              ...(body.costImpact ? { costImpact: body.costImpact } : {}),
              ...(body.scheduleImpact ? { scheduleImpact: body.scheduleImpact } : {}),
              ...(body.scheduleImpactDays !== undefined ? { scheduleImpactDays: body.scheduleImpactDays } : {}),
              ...(body.impactNote !== undefined ? { impactNote: body.impactNote || null } : {}),
            }
          : {}),
      },
    });
    if (res.count === 0) throw new ApiError(409, "This RFI was just answered or changed — refresh the page");
    await audit({
      entityType: "Rfi",
      entityId: rfi.id,
      actorId: user.id,
      actorName: user.name,
      action: "RFI_ANSWERED",
      diff: { project: rfi.project.name, number: label, onBehalfOfClient: verdict.onBehalfOfClient },
    });
    if (user.role === "CLIENT") {
      await notifyOwner(`RFI answered by client`, `${user.name} answered ${label} “${rfi.subject}” on ${rfi.project.name}`);
    }
    return NextResponse.json({ ok: true });
  }

  if (body.action === "close") {
    if (!canCloseRfi(rfi, actor)) throw new ApiError(403, "Only an answered RFI can be closed, by whoever raised it or the PM/Owner");
    const res = await prisma.rfi.updateMany({ where: { id: rfi.id, status: "ANSWERED" }, data: { status: "CLOSED", closedAt: new Date() } });
    if (res.count === 0) throw new ApiError(409, "This RFI changed — refresh the page");
    await audit({ entityType: "Rfi", entityId: rfi.id, actorId: user.id, actorName: user.name, action: "RFI_CLOSED", diff: { project: rfi.project.name, number: label } });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "cancel") {
    if (!canCancelRfi(rfi, actor)) throw new ApiError(403, "Only an open RFI can be cancelled, by whoever raised it or the PM/Owner");
    const res = await prisma.rfi.updateMany({ where: { id: rfi.id, status: "OPEN" }, data: { status: "CANCELLED" } });
    if (res.count === 0) throw new ApiError(409, "This RFI changed — refresh the page");
    await audit({ entityType: "Rfi", entityId: rfi.id, actorId: user.id, actorName: user.name, action: "RFI_CANCELLED", diff: { project: rfi.project.name, number: label } });
    return NextResponse.json({ ok: true });
  }

  if (!isApprover) throw new ApiError(403, "Only the PM or Owner can do this");

  if (body.action === "reopen") {
    if (rfi.status !== "ANSWERED") throw new ApiError(409, "Only an answered RFI can be reopened");
    const res = await prisma.rfi.updateMany({
      where: { id: rfi.id, status: "ANSWERED" },
      data: { status: "OPEN", responseText: null, responsePhotos: undefined, respondedById: null, respondedByName: null, respondedAt: null },
    });
    if (res.count === 0) throw new ApiError(409, "This RFI changed — refresh the page");
    // The earlier answer is preserved in the audit trail even though the live record is cleared for a fresh one.
    await audit({
      entityType: "Rfi",
      entityId: rfi.id,
      actorId: user.id,
      actorName: user.name,
      action: "RFI_REOPENED",
      diff: { project: rfi.project.name, number: label, previousAnswer: rfi.responseText, answeredBy: rfi.respondedByName },
    });
    return NextResponse.json({ ok: true });
  }

  // ----- update (PM/Owner) -----
  const { dueDate } = parseDates(body, ["dueDate"]);
  await assertLinksBelongToProject(rfi.projectId, {
    milestoneId: body.milestoneId,
    siteInstructionId: body.siteInstructionId,
    changeOrderId: body.changeOrderId,
    documentId: body.documentId,
  });
  if (body.assigneeId) {
    if (rfi.addressedTo === "CLIENT") throw new ApiError(400, "A client RFI has no staff assignee");
    await assertActiveStaff(body.assigneeId, "The assignee");
  }
  const updated = await prisma.rfi.update({
    where: { id: rfi.id },
    data: {
      ...(body.assigneeId !== undefined ? { assigneeId: body.assigneeId || null } : {}),
      ...(body.dueDate !== undefined ? { dueDate } : {}),
      ...(body.workItem !== undefined ? { workItem: body.workItem || null } : {}),
      ...(body.dailyReportNo !== undefined ? { dailyReportNo: body.dailyReportNo || null } : {}),
      ...(body.milestoneId !== undefined ? { milestoneId: body.milestoneId || null } : {}),
      ...(body.siteInstructionId !== undefined ? { siteInstructionId: body.siteInstructionId || null } : {}),
      ...(body.changeOrderId !== undefined ? { changeOrderId: body.changeOrderId || null } : {}),
      ...(body.documentId !== undefined ? { documentId: body.documentId || null } : {}),
      ...(body.costImpact ? { costImpact: body.costImpact } : {}),
      ...(body.scheduleImpact ? { scheduleImpact: body.scheduleImpact } : {}),
      ...(body.scheduleImpactDays !== undefined ? { scheduleImpactDays: body.scheduleImpactDays } : {}),
      ...(body.impactNote !== undefined ? { impactNote: body.impactNote || null } : {}),
    },
  });
  await audit({
    entityType: "Rfi",
    entityId: rfi.id,
    actorId: user.id,
    actorName: user.name,
    action: "RFI_UPDATED",
    diff: { project: rfi.project.name, number: label, changes: JSON.parse(JSON.stringify(body)) },
  });
  return NextResponse.json(updated);
});
