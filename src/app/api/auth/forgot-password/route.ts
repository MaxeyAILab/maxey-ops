import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { handleApi } from "@/lib/rbac";
import { beginAttempt } from "@/lib/login-guard";
import { clientIp } from "@/lib/login-throttle";

const schema = z.object({ email: z.string().email() });

const TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes
const RESEND_COOLDOWN_MS = 2 * 60 * 1000; // basic spam guard

// One response shape regardless of outcome — never reveal whether an email
// is registered (standard forgot-password hardening).
// A function, not a shared object: a Response body can only be read once, so reusing one
// instance would send an empty reply to every request after the first.
const genericOk = () =>
  NextResponse.json({
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
  if (!parsed.success) return genericOk(); // don't leak validation details either

  const email = parsed.data.email.toLowerCase().trim();
  // Same limits as sign-in, so this can't be used to flood someone's inbox or probe emails. When limited, the
  // reply is the same as always — the person just doesn't get another email until the window passes.
  const attempt = await beginAttempt("RESET", email, clientIp(req.headers.get("x-forwarded-for")));
  if (attempt.blocked) return genericOk();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.active) return genericOk();

  const recent = await prisma.passwordResetToken.findFirst({
    where: { userId: user.id, usedAt: null, createdAt: { gte: new Date(Date.now() - RESEND_COOLDOWN_MS) } },
  });
  if (recent) return genericOk(); // already sent one moments ago — don't spam

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

  return genericOk();
});
