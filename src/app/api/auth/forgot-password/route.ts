import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { handleApi } from "@/lib/rbac";

const schema = z.object({ email: z.string().email() });

const TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes
const RESEND_COOLDOWN_MS = 2 * 60 * 1000; // basic spam guard

// One response shape regardless of outcome — never reveal whether an email
// is registered (standard forgot-password hardening).
const GENERIC_OK = NextResponse.json({
  ok: true,
  message: "If an account exists for that email, a reset link has been sent.",
});

/**
 * POST /api/auth/forgot-password — self-service reset request. Works for
 * any active account (staff or client portal) since it's on the shared
 * /login page. No auth required — this IS the recovery path for someone
 * who's locked out.
 */
export const POST = handleApi(async (req: NextRequest) => {
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return GENERIC_OK; // don't leak validation details either

  const email = parsed.data.email.toLowerCase().trim();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.active) return GENERIC_OK;

  const recent = await prisma.passwordResetToken.findFirst({
    where: { userId: user.id, usedAt: null, createdAt: { gte: new Date(Date.now() - RESEND_COOLDOWN_MS) } },
  });
  if (recent) return GENERIC_OK; // already sent one moments ago — don't spam

  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + TOKEN_TTL_MS) },
  });

  const resetUrl = `${process.env.NEXTAUTH_URL}/reset-password?token=${rawToken}`;
  await notify({
    to: { name: user.name, email: user.email, phone: user.phone },
    subject: "Reset your Maxey Construction password",
    message: `Hi ${user.name}, reset your password here (expires in 30 minutes): ${resetUrl}`,
  });

  await audit({
    entityType: "User",
    entityId: user.id,
    actorName: user.name,
    action: "PASSWORD_RESET_REQUESTED",
  });

  return GENERIC_OK;
});
