import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { savePhoto } from "@/lib/storage";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
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
});

/**
 * POST /api/tools/movements — checkout/return/transfer an individual tool
 * asset, or flag it under repair / lost (Spec 6.4 extension, owner's request
 * 2026-07-07). The source project is derived from the tool's current
 * location, not trusted from the client, so the ledger can't be spoofed by a
 * stale form.
 */
export const POST = handleApi(async (req: NextRequest) => {
  const user = await requireUser(["FOREMAN", "PM", "OWNER", "PURCHASING"]);
  const body = createSchema.parse(await req.json());

  const dup = await prisma.toolMovement.findUnique({ where: { clientUuid: body.clientUuid } });
  if (dup) return NextResponse.json({ error: "Already synced", id: dup.id }, { status: 409 });

  const tool = await prisma.toolAsset.findUnique({ where: { id: body.toolId } });
  if (!tool) throw new ApiError(404, "Tool not found");

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
        actorId: user.id,
        createdAt: body.submittedAt,
      },
    });
    await db.toolAsset.update({
      where: { id: tool.id },
      data: {
        status: nextStatus,
        currentProjectId: nextProjectId,
        condition: body.condition || undefined,
      },
    });
    return movement;
  });

  await audit({
    entityType: "ToolAsset",
    entityId: tool.id,
    actorId: user.id,
    actorName: user.name,
    action: `TOOL_${body.type}`,
    diff: { tool: tool.name, condition: body.condition || null },
  });

  return NextResponse.json(movement, { status: 201 });
});
