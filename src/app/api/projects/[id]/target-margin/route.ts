import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";

const patchSchema = z.object({
  targetMarginPct: z.coerce.number().min(-100).max(100).nullable(),
});

/**
 * PATCH /api/projects/[id]/target-margin — the margin % bid at contract
 * signing, set once and rarely touched again. Kept separate from the
 * lifecycle-status PATCH so that endpoint's contract never has to change.
 */
export const PATCH = handleApi(
  async (req: NextRequest, { params }: { params: { id: string } }) => {
    const user = await requireUser(["OWNER"]);
    const body = patchSchema.parse(await req.json());

    const project = await prisma.project.findUnique({ where: { id: params.id } });
    if (!project) throw new ApiError(404, "Project not found");

    const updated = await prisma.project.update({
      where: { id: params.id },
      data: { targetMarginPct: body.targetMarginPct },
    });

    await audit({
      entityType: "Project",
      entityId: project.id,
      actorId: user.id,
      actorName: user.name,
      action: "PROJECT_TARGET_MARGIN_SET",
      diff: {
        from: project.targetMarginPct != null ? Number(project.targetMarginPct) : null,
        to: body.targetMarginPct,
      },
    });

    return NextResponse.json(updated);
  }
);
