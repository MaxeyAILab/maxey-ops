import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import { canAddInventoryCatalog, canDeleteTool, canLogInventoryMovement } from "@/lib/access";
import { TOOL_CONDITIONS, TOOL_CONDITION_LABEL } from "@/lib/tool-condition";
import { WAREHOUSE_VALUES, warehouseLabel, type WarehouseValue } from "@/lib/warehouses";

const patchSchema = z
  .object({
    workingStatus: z.enum(TOOL_CONDITIONS).optional(),
    name: z.string().trim().min(1).max(200).optional(),
    assetTag: z.string().trim().max(50).optional(),
    category: z.string().trim().max(100).optional(),
    warehouse: z.enum(WAREHOUSE_VALUES).optional(),
  })
  .refine((b) => b.workingStatus !== undefined || b.name !== undefined || b.assetTag !== undefined || b.category !== undefined || b.warehouse !== undefined, { message: "Nothing to change" });

/**
 * PATCH /api/tools/[id] — change a tool or piece of equipment after it was added:
 *  - how it is doing (working, for repair, not working, for disposal): anyone who can log inventory movements, since a broken
 *    tool is usually noticed on site;
 *  - its name, asset tag or category (fixing what was typed or forgotten): the people who can add tools (office staff, Owner,
 *    PM, Purchasing).
 * Every change is recorded with who made it and what it was before.
 */
export const PATCH = handleApi(async (req: NextRequest, { params }: { params: { id: string } }) => {
  const user = await requireUser();
  const body = patchSchema.parse(await req.json());
  const editsDetails = body.name !== undefined || body.assetTag !== undefined || body.category !== undefined || body.warehouse !== undefined;
  if (body.workingStatus !== undefined && !canLogInventoryMovement(user)) throw new ApiError(403, "Not authorized for this action");
  if (editsDetails && !canAddInventoryCatalog(user)) throw new ApiError(403, "Only office staff can edit a tool's name, tag or category");
  const tool = await prisma.toolAsset.findUnique({ where: { id: params.id } });
  if (!tool) throw new ApiError(404, "Tool not found");

  const data: { workingStatus?: typeof tool.workingStatus; name?: string; assetTag?: string | null; category?: string | null; warehouse?: WarehouseValue } = {};
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  if (body.name !== undefined && body.name !== tool.name) {
    data.name = body.name;
    changes.name = { from: tool.name, to: body.name };
  }
  if (body.assetTag !== undefined && (body.assetTag || null) !== tool.assetTag) {
    data.assetTag = body.assetTag || null;
    changes.assetTag = { from: tool.assetTag, to: body.assetTag || null };
  }
  if (body.category !== undefined && (body.category || null) !== tool.category) {
    data.category = body.category || null;
    changes.category = { from: tool.category, to: body.category || null };
  }
  if (body.warehouse !== undefined && body.warehouse !== tool.warehouse) {
    data.warehouse = body.warehouse;
    changes.warehouse = { from: warehouseLabel(tool.warehouse), to: warehouseLabel(body.warehouse) };
  }
  const conditionChanged = body.workingStatus !== undefined && body.workingStatus !== tool.workingStatus;
  if (conditionChanged) data.workingStatus = body.workingStatus;
  if (Object.keys(data).length === 0) return NextResponse.json({ ok: true });

  await prisma.toolAsset.update({ where: { id: tool.id }, data });
  if (Object.keys(changes).length > 0) {
    await audit({ entityType: "ToolAsset", entityId: tool.id, actorId: user.id, actorName: user.name, action: "TOOL_EDITED", diff: { tool: tool.name, changes } as never });
  }
  if (conditionChanged) {
    await audit({
      entityType: "ToolAsset",
      entityId: tool.id,
      actorId: user.id,
      actorName: user.name,
      action: "TOOL_CONDITION_CHANGED",
      diff: { tool: tool.name, from: TOOL_CONDITION_LABEL[tool.workingStatus], to: TOOL_CONDITION_LABEL[body.workingStatus!] },
    });
  }
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
      location: tool.currentProject?.name ?? warehouseLabel(tool.warehouse),
      movementsRemoved: tool._count.movements,
    },
  });
  return NextResponse.json({ ok: true });
});
