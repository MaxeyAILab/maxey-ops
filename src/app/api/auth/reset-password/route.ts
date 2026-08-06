import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ApiError, handleApi } from "@/lib/rbac";

const schema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8).max(100),
});

/**
 * POST /api/auth/reset-password — redeem a forgot-password token. No auth
 * required (the token itself is the credential). Single-use and time-boxed.
 */
export const POST = handleApi(async (req: NextRequest) => {
  const body = schema.parse(await req.json());
  const tokenHash = crypto.createHash("sha256").update(body.token).digest("hex");

  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!record || record.usedAt || record.expiresAt < new Date() || !record.user.active) {
    throw new ApiError(400, "This reset link is invalid or has expired. Request a new one.");
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: {
        passwordHash: await bcrypt.hash(body.newPassword, 10),
        mustChangePassword: false,
      },
    }),
    prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
  ]);

  await audit({
    entityType: "User",
    entityId: record.userId,
    actorId: record.userId,
    actorName: record.user.name,
    action: "PASSWORD_RESET_COMPLETED",
  });

  return NextResponse.json({ ok: true });
});
