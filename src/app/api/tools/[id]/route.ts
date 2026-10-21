import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import { canDeleteTool, canLogInventoryMovement } from "@/lib/access";
import { TOOL_CONDITIONS, TOOL_CONDITION_LABEL } from "@/lib/tool-condition";

const patchSchema = z.object({ workingStatus: z.enum(TOOL_CONDITIONS) });

/**
 * PATCH /api/tools/[id] — change how a tool or piece of equipment is doing: working, for repair, not working, for disposal.
 * Anyone who can log inventory movements can report it (a broken tool is usually noticed on site); the change is recorded with
 * who made it.
 */
export const PATCH = handleApi(async (req: NextRequest, { params }: { params: { id: string } }) => {
  const user = await requireUser();
  if (!canLogInventoryMovement(user)) throw new ApiError(403, "Not authorized for this action");
  const body = patchSchema.parse(await req.json());
  const tool = await prisma.toolAsset.findUnique({ where: { id: params.id } });
  if (!tool) throw new ApiError(404, "Tool not found");
  if (tool.workingStatus === body.workingStatus) return NextResponse.json({ ok: true });

  await prisma.toolAsset.update({ where: { id: tool.id }, data: { workingStatus: body.workingStatus } });
  await audit({
    entityType: "ToolAsset",
    entityId: tool.id,
    actorId: user.id,
    actorName: user.name,
    action: "TOOL_CONDITION_CHANGED",
    diff: { tool: tool.name, from: TOOL_CONDITION_LABEL[tool.workingStatus], to: TOOL_CONDITION_LABEL[body.workingStatus] },
  });
  return NextResponse.json({ ok: true });
});

/**
 * DELETE /api/tools/[id] — remove a tool or equipment entry, e.g. one typed in wrongly. The Owner can remove any (its movement
 * history goes with it); office staff, PM and Purchasing can remove one that has never been moved. The audit log keeps a copy.
 */
export const DELETE = handleApi(async (_req: Request, { params }: { params: { id: string } }) => {
  const user = await requireUser();
  const tool = await prisma.toolAsset.findUnique({
    where: { id: params.id },
    include: { _count: { select: { movements: true } }, currentProject: { select: { name: true } } },
  });
  if (!tool) throw new ApiError(404, "Tool not found");
  if (!canDeleteTool(user, tool._count.movements)) {
    throw new ApiError(403, user.role === "OWNER" ? "Not authorized" : tool._count.movements > 0 ? "This tool already has movement history — only the Owner can delete it" : "Not authorized for this action");
  }

  await prisma.$transaction(async (db) => {
    await db.toolMovement.deleteMany({ where: { toolId: tool.id } });
    await db.toolAsset.delete({ where: { id: tool.id } });
  });

  await audit({
    entityType: "ToolAsset",
    entityId: tool.id,
    actorId: user.id,
    actorName: user.name,
    action: "TOOL_DELETED",
    diff: {
      name: tool.name,
      assetTag: tool.assetTag,
      category: tool.category,
      status: tool.status,
      condition: TOOL_CONDITION_LABEL[tool.workingStatus],
      location: tool.currentProject?.name ?? "Warehouse",
      movementsRemoved: tool._count.movements,
    },
  });
  return NextResponse.json({ ok: true });
});
