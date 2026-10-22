import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import { canApproveInventoryRequest } from "@/lib/access";
import { toolNeedsApproval } from "@/lib/inventory-requests";
import { savePhotos } from "@/lib/storage";
import { MAX_NEW_REQUEST_PHOTOS, photoRoom, withPhotos } from "@/lib/request-photos";

const patchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve") }),
  z.object({ action: z.literal("reject"), reason: z.string().trim().min(3).max(300) }),
  z.object({ action: z.literal("cancel") }),
  z.object({ action: z.literal("add_photos"), photos: z.array(z.string()).min(1).max(MAX_NEW_REQUEST_PHOTOS) }),
]);

/**
 * PATCH /api/tools/movements/[id] — decide a tool return/transfer request. Approving is what finally moves the tool, and the
 * approver's name is kept. Nobody but the Owner decides their own request; the requester can cancel while it waits.
 */
export const PATCH = handleApi(async (req: NextRequest, { params }: { params: { id: string } }) => {
  const user = await requireUser();
  const body = patchSchema.parse(await req.json());
  const m = await prisma.toolMovement.findUnique({ where: { id: params.id }, include: { tool: true } });
  if (!m || !toolNeedsApproval(m.type)) throw new ApiError(404, "Request not found");
  if (m.status !== "PENDING") throw new ApiError(409, `This request was already ${m.status === "APPLIED" ? "approved" : "rejected"}`);
  const mine = m.actorId === user.id;
  const now = new Date();

  // Photos of the tool can be added while the request waits — by the person who asked, or by whoever approves it.
  if (body.action === "add_photos") {
    if (!mine && !canApproveInventoryRequest(user)) throw new ApiError(403, "Not authorized for this action");
    if (photoRoom(m.photos) === 0) throw new ApiError(400, "This request already has the most photos it can hold");
    const urls = await savePhotos(body.photos.slice(0, photoRoom(m.photos)));
    if (urls.length === 0) throw new ApiError(400, "The photo could not be read — try taking it again");
    const done = await prisma.toolMovement.updateMany({ where: { id: m.id, status: "PENDING" }, data: { photos: withPhotos(m.photos, urls) } });
    if (done.count === 0) throw new ApiError(409, "This request was just decided by someone else");
    await audit({ entityType: "ToolMovement", entityId: m.id, actorId: user.id, actorName: user.name, action: "TOOL_REQUEST_PHOTOS_ADDED", diff: { tool: m.tool.name, added: urls.length } });
    return NextResponse.json({ ok: true, photos: withPhotos(m.photos, urls) });
  }

  if (body.action === "cancel") {
    if (!mine) throw new ApiError(403, "Only the person who made the request can cancel it");
    const done = await prisma.toolMovement.updateMany({ where: { id: m.id, status: "PENDING" }, data: { status: "REJECTED", decidedById: user.id, decidedByName: user.name, decidedAt: now, rejectedReason: "Cancelled by the requester" } });
    if (done.count === 0) throw new ApiError(409, "This request was just decided by someone else");
    await audit({ entityType: "ToolMovement", entityId: m.id, actorId: user.id, actorName: user.name, action: "TOOL_REQUEST_CANCELLED", diff: { tool: m.tool.name } });
    return NextResponse.json({ ok: true });
  }

  if (!canApproveInventoryRequest(user)) throw new ApiError(403, "Only office staff can approve or reject this");
  if (mine && user.role !== "OWNER") throw new ApiError(403, "You can't approve your own request — another office staff member must");

  if (body.action === "reject") {
    const done = await prisma.toolMovement.updateMany({ where: { id: m.id, status: "PENDING" }, data: { status: "REJECTED", decidedById: user.id, decidedByName: user.name, decidedAt: now, rejectedReason: body.reason } });
    if (done.count === 0) throw new ApiError(409, "This request was just decided by someone else");
    await audit({ entityType: "ToolMovement", entityId: m.id, actorId: user.id, actorName: user.name, action: "TOOL_REQUEST_REJECTED", diff: { tool: m.tool.name, reason: body.reason } });
    return NextResponse.json({ ok: true });
  }

  // approve: the tool must still be where it was when the request was made
  if (m.tool.status !== "ON_SITE" || m.tool.currentProjectId !== m.fromProjectId) {
    throw new ApiError(409, `${m.tool.name} is no longer where it was when this was requested — reject this request and ask for a new one`);
  }
  if (m.type === "TRANSFER_SITE_TO_SITE" && (!m.toProjectId || m.toProjectId === m.tool.currentProjectId)) throw new ApiError(400, "This transfer has no valid destination");
  const toWarehouse = m.type === "RETURN_TO_WAREHOUSE";
  await prisma.$transaction(async (db) => {
    const done = await db.toolMovement.updateMany({ where: { id: m.id, status: "PENDING" }, data: { status: "APPLIED", decidedById: user.id, decidedByName: user.name, decidedAt: now } });
    if (done.count === 0) throw new ApiError(409, "This request was just decided by someone else");
    await db.toolAsset.update({
      where: { id: m.toolId },
      data: toWarehouse ? { status: "IN_WAREHOUSE", currentProjectId: null } : { status: "ON_SITE", currentProjectId: m.toProjectId },
    });
  });
  await audit({ entityType: "ToolMovement", entityId: m.id, actorId: user.id, actorName: user.name, action: "TOOL_REQUEST_APPROVED", diff: { tool: m.tool.name, type: m.type } });
  return NextResponse.json({ ok: true });
});
