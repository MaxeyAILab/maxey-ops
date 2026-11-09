import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import { canAddInventoryCatalog } from "@/lib/access";
import { TOOL_CONDITIONS, TOOL_CONDITION_LABEL, type ToolConditionValue } from "@/lib/tool-condition";
import { WAREHOUSE_VALUES, warehouseLabel } from "@/lib/warehouses";
import { TOOL_CATEGORIES, isCountedCategory, normalizeToolCategory } from "@/lib/tool-category";
import { wholeQty } from "@/lib/tool-lots";

const createSchema = z.object({
  name: z.string().min(1).max(200),
  assetTag: z.string().max(50).optional().or(z.literal("")),
  category: z.string().max(100).optional().or(z.literal("")),
  /** how it is doing when it is added: working, for repair, not working, for disposal */
  workingStatus: z.enum(TOOL_CONDITIONS).default("WORKING"),
  /** the warehouse it starts in, and returns to (the Main Warehouse when not said) */
  warehouse: z.enum(WAREHOUSE_VALUES).default("MAIN"),
  /** pieces being added — only for a counted category (Scaffolding & Shoring) */
  quantity: z.union([z.number(), z.string()]).optional(),
});

/**
 * POST /api/tools — register a new tool/equipment asset (Spec 6.4 extension,
 * owner's request 2026-07-07). Each unit is its own row, starting in the
 * warehouse, so it can be checked out to a project and tracked individually.
 */
export const POST = handleApi(async (req: NextRequest) => {
  const user = await requireUser();
  if (!canAddInventoryCatalog(user)) throw new ApiError(403, "Not authorized for this action");
  const body = createSchema.parse(await req.json());
  // every tool goes in one of the four groups (older wording like "Power Tool" is accepted and saved under its proper name)
  const category = normalizeToolCategory(body.category);
  if (!category) throw new ApiError(400, `Choose a category: ${TOOL_CATEGORIES.map((c) => c.label).join(", ")}`);

  // Scaffolding & Shoring is counted: "100 base jacks" is one entry with a quantity, and adding the same item again adds to it.
  if (isCountedCategory(category)) {
    const pieces = wholeQty(body.quantity);
    if (pieces === null) throw new ApiError(400, "Enter how many pieces — a whole number, 1 or more");
    const name = body.name.trim();
    const pool = await prisma.$transaction(async (db) => {
      const existing = await db.toolAsset.findFirst({
        where: { name: { equals: name, mode: "insensitive" }, category, warehouse: body.warehouse, status: "IN_WAREHOUSE", currentProjectId: null },
      });
      if (existing) return { tool: await db.toolAsset.update({ where: { id: existing.id }, data: { quantity: { increment: pieces } } }), added: true, before: existing.quantity };
      return { tool: await db.toolAsset.create({ data: { name, category, warehouse: body.warehouse, quantity: pieces, workingStatus: "WORKING" } }), added: false, before: 0 };
    });
    await audit({
      entityType: "ToolAsset",
      entityId: pool.tool.id,
      actorId: user.id,
      actorName: user.name,
      action: pool.added ? "TOOL_PIECES_ADDED" : "TOOL_REGISTERED",
      diff: { name, warehouse: warehouseLabel(body.warehouse), category, pieces, before: pool.before, now: pool.tool.quantity },
    });
    return NextResponse.json(pool.tool, { status: 201 });
  }

  const tool = await prisma.toolAsset.create({
    data: {
      name: body.name,
      assetTag: body.assetTag || null,
      category,
      workingStatus: body.workingStatus,
      warehouse: body.warehouse,
    },
  });

  await audit({
    entityType: "ToolAsset",
    entityId: tool.id,
    actorId: user.id,
    actorName: user.name,
    action: "TOOL_REGISTERED",
    diff: { name: body.name, warehouse: warehouseLabel(body.warehouse), assetTag: body.assetTag || null, category, condition: TOOL_CONDITION_LABEL[body.workingStatus as ToolConditionValue] },
  });

  return NextResponse.json(tool, { status: 201 });
});
