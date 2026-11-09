import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hasInventoryOwnerPowers } from "@/lib/owner-authority";
import { audit } from "@/lib/audit";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import { canAddInventoryCatalog, canDeleteTool, canLogInventoryMovement } from "@/lib/access";
import { TOOL_CONDITIONS, TOOL_CONDITION_LABEL } from "@/lib/tool-condition";
import { WAREHOUSE_VALUES, warehouseLabel, type WarehouseValue } from "@/lib/warehouses";
import { TOOL_CATEGORIES, isCountedCategory, normalizeToolCategory } from "@/lib/tool-category";

const patchSchema = z
  .object({
    workingStatus: z.enum(TOOL_CONDITIONS).optional(),
    name: z.string().trim().min(1).max(200).optional(),
    assetTag: z.string().trim().max(50).optional(),
    category: z.string().trim().max(100).optional(),
    warehouse: z.enum(WAREHOUSE_VALUES).optional(),
    /** correct the number of pieces in this pool (counted tools only) */
    quantity: z.number().int().min(0).max(1_000_000).optional(),
  })
  .refine((b) => b.workingStatus !== undefined || b.name !== undefined || b.assetTag !== undefined || b.category !== undefined || b.warehouse !== undefined || b.quantity !== undefined, { message: "Nothing to change" });

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
  const editsDetails = body.name !== undefined || body.assetTag !== undefined || body.category !== undefined || body.warehouse !== undefined || body.quantity !== undefined;
  if (body.workingStatus !== undefined && !canLogInventoryMovement(user)) throw new ApiError(403, "Not authorized for this action");
  if (editsDetails && !canAddInventoryCatalog(user)) throw new ApiError(403, "Only office staff can edit a tool's name, tag or category");
  // a category must be one of the four groups (empty clears it); older wording is saved under its proper name
  const newCategory = body.category === undefined ? undefined : normalizeToolCategory(body.category);
  if (newCategory === undefined && body.category !== undefined) throw new ApiError(400, `Choose a category: ${TOOL_CATEGORIES.map((c) => c.label).join(", ")}`);
  const tool = await prisma.toolAsset.findUnique({ where: { id: params.id } });
  if (!tool) throw new ApiError(404, "Tool not found");
  const counted = isCountedCategory(tool.category);
  if (body.quantity !== undefined && !counted) throw new ApiError(400, "Only a counted tool (Scaffolding & Shoring) has a quantity");
  if (counted && body.workingStatus !== undefined) throw new ApiError(400, "Pieces of Scaffolding & Shoring are counted, not given a condition — mark them under repair or lost when they are moved");
  if (newCategory !== undefined && isCountedCategory(newCategory) !== counted) {
    throw new ApiError(400, counted ? "Scaffolding & Shoring is counted by quantity — it can't be changed into an individually tracked category" : "An individually tracked tool can't be changed into Scaffolding & Shoring — add it again there with its quantity, then delete this one");
  }
  if (counted && body.warehouse !== undefined && body.warehouse !== tool.warehouse && tool.status !== "IN_WAREHOUSE") {
    throw new ApiError(400, "Move its home warehouse only for the pieces kept in the warehouse");
  }

  const data: { quantity?: number; workingStatus?: typeof tool.workingStatus; name?: string; assetTag?: string | null; category?: string | null; warehouse?: WarehouseValue } = {};
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  if (body.name !== undefined && body.name !== tool.name) {
    data.name = body.name;
    changes.name = { from: tool.name, to: body.name };
  }
  if (body.assetTag !== undefined && (body.assetTag || null) !== tool.assetTag) {
    data.assetTag = body.assetTag || null;
    changes.assetTag = { from: tool.assetTag, to: body.assetTag || null };
  }
  if (newCategory !== undefined && newCategory !== tool.category) {
    data.category = newCategory;
    changes.category = { from: tool.category, to: newCategory };
  }
  if (body.warehouse !== undefined && body.warehouse !== tool.warehouse) {
    data.warehouse = body.warehouse;
    changes.warehouse = { from: warehouseLabel(tool.warehouse), to: warehouseLabel(body.warehouse) };
  }
  if (body.quantity !== undefined && body.quantity !== tool.quantity) {
    data.quantity = body.quantity;
    changes.pieces = { from: tool.quantity, to: body.quantity };
  }
  const conditionChanged = body.workingStatus !== undefined && body.workingStatus !== tool.workingStatus;
  if (conditionChanged) data.workingStatus = body.workingStatus;
  if (Object.keys(data).length === 0) return NextResponse.json({ ok: true });

  // renaming a counted item renames every pool of it (warehouse, projects…), so they still match up
  if (counted && data.name !== undefined) {
    await prisma.toolAsset.updateMany({ where: { name: tool.name, category: tool.category, warehouse: tool.warehouse, id: { not: tool.id } }, data: { name: data.name } });
  }
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
    throw new ApiError(403, hasInventoryOwnerPowers(user) ? "Not authorized" : tool._count.movements > 0 ? "This tool already has movement history — only the Owner can delete it" : "Not authorized for this action");
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
      pieces: tool.quantity,
    },
  });
  return NextResponse.json({ ok: true });
});
