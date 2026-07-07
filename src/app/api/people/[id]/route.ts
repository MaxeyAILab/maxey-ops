import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";

const actionSchema = z.object({
  action: z.enum(["deactivate", "reactivate", "reset-password"]),
});

/**
 * PATCH /api/people/[id] — account lifecycle (People page). Accounts are
 * never deleted: deactivation blocks login instantly while preserving the
 * full audit/approval/payroll history (Spec §8).
 */
export const PATCH = handleApi(
  async (req: NextRequest, { params }: { params: { id: string } }) => {
    const user = await requireUser(["OWNER"]); // account lifecycle is Owner-only
    const body = actionSchema.parse(await req.json());

    const target = await prisma.user.findUnique({ where: { id: params.id } });
    if (!target) throw new ApiError(404, "Account not found");
    if (target.role === "OWNER") throw new ApiError(400, "The owner account cannot be modified here");
    if (target.id === user.id) throw new ApiError(400, "Use your own account settings instead");

    if (body.action === "deactivate") {
      if (!target.active) throw new ApiError(400, "Already deactivated");
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
        action: "ACCOUNT_DEACTIVATED",
        diff: { name: target.name, role: target.role },
      });
      return NextResponse.json({ ok: true });
    }

    if (body.action === "reactivate") {
      if (target.active) throw new ApiError(400, "Already active");
      await prisma.user.update({ where: { id: target.id }, data: { active: true } });
      await audit({
        entityType: "User",
        entityId: target.id,
        actorId: user.id,
        actorName: user.name,
        action: "ACCOUNT_REACTIVATED",
        diff: { name: target.name, role: target.role },
      });
      return NextResponse.json({ ok: true });
    }

    // reset-password: issue a fresh temp password, force change on next login
    const tempPassword = crypto.randomBytes(5).toString("hex");
    await prisma.user.update({
      where: { id: target.id },
      data: { passwordHash: await bcrypt.hash(tempPassword, 10), mustChangePassword: true },
    });
    await audit({
      entityType: "User",
      entityId: target.id,
      actorId: user.id,
      actorName: user.name,
      action: "PASSWORD_RESET",
      diff: { name: target.name },
    });
    return NextResponse.json({ ok: true, tempPassword });
  }
);
