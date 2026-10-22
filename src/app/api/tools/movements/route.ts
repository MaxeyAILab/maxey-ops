import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { savePhoto, savePhotos } from "@/lib/storage";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import { canLogInventoryMovement } from "@/lib/access";
import { toolNeedsApproval } from "@/lib/inventory-requests";
import { MAX_NEW_REQUEST_PHOTOS } from "@/lib/request-photos";
import { TOOL_CONDITION_LABEL, blocksCheckout, conditionAfterMovement } from "@/lib/tool-condition";
import type { ToolStatus } from "@prisma/client";

const TOOL_MOVEMENT_TYPES = [
  "CHECKOUT_TO_SITE",
  "RETURN_TO_WAREHOUSE",
  "TRANSFER_SITE_TO_SITE",
  "MARK_UNDER_REPAIR",
  "MARK_LOST",
  "MARK_AVAILABLE",
] as const;

const createSchema = z.object({
  clientUuid: z.string().uuid(),
  submittedAt: z.coerce.date(),
  toolId: z.string().min(1),
  type: z.enum(TOOL_MOVEMENT_TYPES),
  toProjectId: z.string().optional().or(z.literal("")), // required for checkout/transfer
  condition: z.string().max(300).optional().or(z.literal("")),
  photo: z.string().optional(), // single compressed data URL (damage/condition proof)
  photos: z.array(z.string()).max(MAX_NEW_REQUEST_PHOTOS).optional(), // compressed data URLs: the tool being returned / transferred
});

/**
 * POST /api/tools/movements — checkout/return/transfer an individual tool
 * asset, or flag it under repair / lost (Spec 6.4 extension, owner's request
 * 2026-07-07). The source project is derived from the tool's current
 * location, not trusted from the client, so the ledger can't be spoofed by a
 * stale form.
 *
 * A RETURN to the warehouse and a TRANSFER to another project are requests (status PENDING, 2026-10-21): the tool stays
 * where it is until office staff approve (PATCH /[id]). The Owner's own requests are approved on the spot. Checkouts and the
 * repair/lost/available flags apply at once. Every movement records who logged it.
 */
export const POST = handleApi(async (req: NextRequest) => {
  const user = await requireUser();
  if (!canLogInventoryMovement(user)) throw new ApiError(403, "Not authorized for this action");
  const body = createSchema.parse(await req.json());

  const dup = await prisma.toolMovement.findUnique({ where: { clientUuid: body.clientUuid } });
  if (dup) return NextResponse.json({ error: "Already synced", id: dup.id }, { status: 409 });

  const tool = await prisma.toolAsset.findUnique({ where: { id: body.toolId } });
  if (!tool) throw new ApiError(404, "Tool not found");

  const waiting = await prisma.toolMovement.findFirst({ where: { toolId: tool.id, status: "PENDING" }, select: { id: true } });
  if (waiting) throw new ApiError(400, `${tool.name} already has a request waiting for approval — wait until it is decided`);

  const toProjectId = body.toProjectId || null;
  const fromProjectId = tool.currentProjectId; // derived from actual state, not client input

  let nextStatus: ToolStatus;
  let nextProjectId: string | null;

  switch (body.type) {
    case "CHECKOUT_TO_SITE":
      if (tool.status !== "IN_WAREHOUSE") {
        throw new ApiError(400, `${tool.name} is not in the warehouse (currently ${tool.status})`);
      }
      if (!toProjectId) throw new ApiError(400, "Select a project to check out to");
      if (blocksCheckout(tool.workingStatus)) {
        throw new ApiError(400, `${tool.name} is marked “${TOOL_CONDITION_LABEL[tool.workingStatus]}” — it can't be checked out until it is working again`);
      }
      nextStatus = "ON_SITE";
      nextProjectId = toProjectId;
      break;
    case "RETURN_TO_WAREHOUSE":
      if (tool.status !== "ON_SITE") {
        throw new ApiError(400, `${tool.name} is not currently on a site`);
      }
      nextStatus = "IN_WAREHOUSE";
      nextProjectId = null;
      break;
    case "TRANSFER_SITE_TO_SITE":
      if (tool.status !== "ON_SITE") {
        throw new ApiError(400, `${tool.name} is not currently on a site`);
      }
      if (!toProjectId) throw new ApiError(400, "Select a project to transfer to");
      if (toProjectId === fromProjectId) throw new ApiError(400, "Already at that project");
      nextStatus = "ON_SITE";
      nextProjectId = toProjectId;
      break;
    case "MARK_UNDER_REPAIR":
      if (tool.status === "UNDER_REPAIR") throw new ApiError(400, "Already under repair");
      nextStatus = "UNDER_REPAIR";
      nextProjectId = tool.currentProjectId;
      break;
    case "MARK_LOST":
      if (tool.status === "LOST") throw new ApiError(400, "Already marked lost");
      nextStatus = "LOST";
      nextProjectId = tool.currentProjectId;
      break;
    case "MARK_AVAILABLE":
      if (tool.status !== "UNDER_REPAIR" && tool.status !== "LOST") {
        throw new ApiError(400, `${tool.name} is not under repair or lost`);
      }
      nextStatus = "IN_WAREHOUSE";
      nextProjectId = null;
      break;
  }

  const photoUrl = body.photo ? await savePhoto(body.photo).catch(() => null) : null;
  const photoUrls = await savePhotos(body.photos);
  const isRequest = toolNeedsApproval(body.type) && user.role !== "OWNER";
  const decided = !isRequest && toolNeedsApproval(body.type) ? { decidedById: user.id, decidedByName: user.name, decidedAt: new Date() } : {};

  const movement = await prisma.$transaction(async (db) => {
    const movement = await db.toolMovement.create({
      data: {
        clientUuid: body.clientUuid,
        toolId: tool.id,
        type: body.type,
        fromProjectId,
        toProjectId: ["CHECKOUT_TO_SITE", "TRANSFER_SITE_TO_SITE"].includes(body.type)
          ? toProjectId
          : null,
        condition: body.condition || null,
        photoUrl,
        photos: photoUrls.length ? photoUrls : undefined,
        actorId: user.id,
        createdAt: body.submittedAt,
        status: isRequest ? "PENDING" : "APPLIED",
        ...decided,
      },
    });
    if (!isRequest) {
      await db.toolAsset.update({
        where: { id: tool.id },
        data: {
          status: nextStatus,
          currentProjectId: nextProjectId,
          condition: body.condition || undefined,
          workingStatus: conditionAfterMovement(body.type, tool.workingStatus),
        },
      });
    }
    return movement;
  });

  await audit({
    entityType: isRequest ? "ToolMovement" : "ToolAsset",
    entityId: isRequest ? movement.id : tool.id,
    actorId: user.id,
    actorName: user.name,
    action: isRequest ? "TOOL_REQUEST_SUBMITTED" : `TOOL_${body.type}`,
    diff: { tool: tool.name, type: body.type, condition: body.condition || null, photos: photoUrls.length },
  });

  return NextResponse.json(movement, { status: 201 });
});
