import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { notifyUser } from "@/lib/notify-user";
import { savePhotos } from "@/lib/storage";
import { parseDates } from "@/lib/date-input";
import {
  canCloseFinding,
  canReopenFinding,
  canSendBackFinding,
  canViewFinding,
  canWorkFinding,
  closureProblems,
  formatFindingNumber,
} from "@/lib/findings";
import { assertActiveStaff } from "@/lib/rfi-links";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";

const patchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start") }),
  z.object({
    action: z.literal("submit_closure"),
    note: z.string().trim().max(3000),
    photos: z.array(z.string()).max(4).optional(),
  }),
  z.object({ action: z.literal("close") }),
  z.object({ action: z.literal("send_back"), note: z.string().trim().min(3, "Say what still needs fixing").max(2000) }),
  z.object({ action: z.literal("reopen"), note: z.string().trim().min(3, "Say why it is being reopened").max(2000) }),
  z.object({
    action: z.literal("update"),
    ownerId: z.string().optional().nullable(),
    dueDate: z.string().optional().nullable(),
    severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
    title: z.string().trim().min(3).max(200).optional(),
    description: z.string().trim().min(3).max(5000).optional(),
    location: z.string().trim().max(200).optional().nullable(),
  }),
]);

/**
 * PATCH /api/findings/[id] — move a finding through its lifecycle.
 * A finding the caller isn't allowed to see (a restricted incident) answers 404 to every action,
 * so its existence isn't revealed. Every status change is a conditional update on the status we
 * expect, so a double click or two people at once can only apply it once.
 */
export const PATCH = handleApi(async (req: NextRequest, { params }: { params: { id: string } }) => {
  const user = await requireUser(["OWNER", "PM", "FOREMAN", "OFFICE", "PURCHASING", "ACCOUNTING", "DRIVER"]);
  const body = patchSchema.parse(await req.json());
  const viewer = { id: user.id, role: user.role };

  const f = await prisma.finding.findUnique({ where: { id: params.id }, include: { project: { select: { name: true } } } });
  if (!f || !canViewFinding(f, viewer)) throw new ApiError(404, "Finding not found");
  const label = formatFindingNumber(f.number);
  const base = { entityType: "Finding", entityId: f.id, actorId: user.id, actorName: user.name } as const;
  const safe = f.restricted ? {} : { title: f.title };

  if (body.action === "start") {
    if (!canWorkFinding(f, viewer)) throw new ApiError(403, "Only the person responsible, the PM or the Owner can do this");
    const res = await prisma.finding.updateMany({ where: { id: f.id, status: "OPEN" }, data: { status: "IN_PROGRESS" } });
    if (res.count === 0) throw new ApiError(409, "This finding was just changed — refresh the page");
    await audit({ ...base, action: "FINDING_STARTED", diff: { project: f.project.name, number: label, ...safe } });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "submit_closure") {
    if (!canWorkFinding(f, viewer)) throw new ApiError(403, "Only the person responsible, the PM or the Owner can do this");
    const photos = await savePhotos(body.photos);
    const problem = closureProblems(f, { note: body.note, photoCount: photos.length });
    if (problem) throw new ApiError(400, problem);
    const res = await prisma.finding.updateMany({
      where: { id: f.id, status: { in: ["OPEN", "IN_PROGRESS"] } },
      data: {
        status: "READY_FOR_REVIEW",
        closureNote: body.note,
        closurePhotos: photos.length ? photos : undefined,
        closureSubmittedById: user.id,
        closureSubmittedAt: new Date(),
        reviewNote: null,
      },
    });
    if (res.count === 0) throw new ApiError(409, "This finding was just changed — refresh the page");
    await audit({ ...base, action: "FINDING_CLOSURE_SUBMITTED", diff: { project: f.project.name, number: label, ...safe } });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "close") {
    if (!canCloseFinding(f, viewer)) {
      throw new ApiError(
        403,
        f.status !== "READY_FOR_REVIEW"
          ? "Only a finding that's ready for review can be closed"
          : "A different person has to review the fix — the person who submitted it can't close it"
      );
    }
    const res = await prisma.finding.updateMany({
      where: { id: f.id, status: "READY_FOR_REVIEW" },
      data: { status: "CLOSED", closedById: user.id, closedByName: user.name, closedAt: new Date() },
    });
    if (res.count === 0) throw new ApiError(409, "This finding was just changed — refresh the page");
    await audit({ ...base, action: "FINDING_CLOSED", diff: { project: f.project.name, number: label, ...safe } });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "send_back") {
    if (!canSendBackFinding(f, viewer)) throw new ApiError(403, "Only a PM or Owner can send a finding back, and only while it's ready for review");
    const res = await prisma.finding.updateMany({ where: { id: f.id, status: "READY_FOR_REVIEW" }, data: { status: "IN_PROGRESS", reviewNote: body.note } });
    if (res.count === 0) throw new ApiError(409, "This finding was just changed — refresh the page");
    await audit({ ...base, action: "FINDING_SENT_BACK", diff: { project: f.project.name, number: label, note: body.note } });
    if (f.closureSubmittedById) await notifyUser(f.closureSubmittedById, "A finding was sent back", `${label} on ${f.project.name} needs more work — open Maxey Ops to see why.`);
    return NextResponse.json({ ok: true });
  }

  if (body.action === "reopen") {
    if (!canReopenFinding(f, viewer)) throw new ApiError(403, "Only the Owner can reopen a closed finding");
    const res = await prisma.finding.updateMany({
      where: { id: f.id, status: "CLOSED" },
      data: { status: "OPEN", closedAt: null, closedById: null, closedByName: null, reviewNote: body.note },
    });
    if (res.count === 0) throw new ApiError(409, "This finding was just changed — refresh the page");
    await audit({ ...base, action: "FINDING_REOPENED", diff: { project: f.project.name, number: label, note: body.note } });
    return NextResponse.json({ ok: true });
  }

  // ----- update (Owner / PM) -----
  if (user.role !== "OWNER" && user.role !== "PM") throw new ApiError(403, "Only the PM or Owner can edit a finding");
  if (f.status === "CLOSED") throw new ApiError(409, "A closed finding can't be edited — reopen it first");
  const { dueDate } = parseDates(body, ["dueDate"]);
  if (body.ownerId) await assertActiveStaff(body.ownerId, "The person responsible");
  const updated = await prisma.finding.update({
    where: { id: f.id },
    data: {
      ...(body.ownerId !== undefined ? { ownerId: body.ownerId || null } : {}),
      ...(body.dueDate !== undefined ? { dueDate } : {}),
      ...(body.severity ? { severity: body.severity } : {}),
      ...(body.title ? { title: body.title } : {}),
      ...(body.description ? { description: body.description } : {}),
      ...(body.location !== undefined ? { location: body.location || null } : {}),
    },
  });
  await audit({
    ...base,
    action: "FINDING_UPDATED",
    diff: { project: f.project.name, number: label, from: { severity: f.severity, ownerId: f.ownerId }, to: { severity: updated.severity, ownerId: updated.ownerId } },
  });
  if (body.ownerId && body.ownerId !== f.ownerId && body.ownerId !== user.id) {
    await notifyUser(body.ownerId, "A finding was assigned to you", `${label} on ${f.project.name} — open Maxey Ops to see it.`);
  }
  return NextResponse.json({ ok: true });
});
