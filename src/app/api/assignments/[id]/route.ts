import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";

/**
 * DELETE /api/assignments/[id] — remove an employee from a project roster.
 * Soft-delete (active=false): history and past payroll runs stay intact.
 */
export const DELETE = handleApi(
  async (_req: NextRequest, { params }: { params: { id: string } }) => {
    const user = await requireUser(["OWNER", "ACCOUNTING"]);

    const assignment = await prisma.projectAssignment.findUnique({
      where: { id: params.id },
      include: { project: { select: { name: true } }, user: { select: { name: true } } },
    });
    if (!assignment) throw new ApiError(404, "Assignment not found");

    await prisma.projectAssignment.update({
      where: { id: params.id },
      data: { active: false },
    });

    await audit({
      entityType: "ProjectAssignment",
      entityId: assignment.id,
      actorId: user.id,
      actorName: user.name,
      action: "EMPLOYEE_UNASSIGNED",
      diff: { project: assignment.project.name, employee: assignment.user.name },
    });

    return NextResponse.json({ ok: true });
  }
);
