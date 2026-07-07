import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";

/**
 * DELETE /api/personnel/[id] — "Remove personnel" (resignation). Deactivates
 * the account and their project assignments; attendance and payroll history
 * are preserved (append-only, Spec §8).
 */
export const DELETE = handleApi(
  async (_req: NextRequest, { params }: { params: { id: string } }) => {
    const user = await requireUser(["OWNER"]); // only the Owner removes accounts

    const target = await prisma.user.findUnique({ where: { id: params.id } });
    if (!target) throw new ApiError(404, "Personnel not found");
    if (target.role === "OWNER") throw new ApiError(400, "The owner account cannot be removed");
    if (target.id === user.id) throw new ApiError(400, "You cannot remove yourself");
    if (!target.active) throw new ApiError(400, "Already removed");

    await prisma.$transaction([
      prisma.user.update({ where: { id: target.id }, data: { active: false } }),
      prisma.projectAssignment.updateMany({
        where: { userId: target.id },
        data: { active: false },
      }),
    ]);

    await audit({
      entityType: "User",
      entityId: target.id,
      actorId: user.id,
      actorName: user.name,
      action: "PERSONNEL_REMOVED",
      diff: { name: target.name, position: target.position ?? null },
    });

    return NextResponse.json({ ok: true });
  }
);
