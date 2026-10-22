import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import { canAddInventoryCatalog } from "@/lib/access";
import { TOOL_CONDITIONS, TOOL_CONDITION_LABEL, type ToolConditionValue } from "@/lib/tool-condition";
import { WAREHOUSE_VALUES, warehouseLabel } from "@/lib/warehouses";

const createSchema = z.object({
  name: z.string().min(1).max(200),
  assetTag: z.string().max(50).optional().or(z.literal("")),
  category: z.string().max(100).optional().or(z.literal("")),
  /** how it is doing when it is added: working, for repair, not working, for disposal */
  workingStatus: z.enum(TOOL_CONDITIONS).default("WORKING"),
  /** the warehouse it starts in, and returns to (the Main Warehouse when not said) */
  warehouse: z.enum(WAREHOUSE_VALUES).default("MAIN"),
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

  const tool = await prisma.toolAsset.create({
    data: {
      name: body.name,
      assetTag: body.assetTag || null,
      category: body.category || null,
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
    diff: { name: body.name, warehouse: warehouseLabel(body.warehouse), assetTag: body.assetTag || null, category: body.category || null, condition: TOOL_CONDITION_LABEL[body.workingStatus as ToolConditionValue] },
  });

  return NextResponse.json(tool, { status: 201 });
});
