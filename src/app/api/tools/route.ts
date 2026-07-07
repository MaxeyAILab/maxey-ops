import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { handleApi, requireUser } from "@/lib/rbac";

const createSchema = z.object({
  name: z.string().min(1).max(200),
  assetTag: z.string().max(50).optional().or(z.literal("")),
  category: z.string().max(100).optional().or(z.literal("")),
});

/**
 * POST /api/tools — register a new tool/equipment asset (Spec 6.4 extension,
 * owner's request 2026-07-07). Each unit is its own row, starting in the
 * warehouse, so it can be checked out to a project and tracked individually.
 */
export const POST = handleApi(async (req: NextRequest) => {
  const user = await requireUser(["OWNER", "PM", "PURCHASING"]);
  const body = createSchema.parse(await req.json());

  const tool = await prisma.toolAsset.create({
    data: {
      name: body.name,
      assetTag: body.assetTag || null,
      category: body.category || null,
    },
  });

  await audit({
    entityType: "ToolAsset",
    entityId: tool.id,
    actorId: user.id,
    actorName: user.name,
    action: "TOOL_REGISTERED",
    diff: { name: body.name, assetTag: body.assetTag || null, category: body.category || null },
  });

  return NextResponse.json(tool, { status: 201 });
});
