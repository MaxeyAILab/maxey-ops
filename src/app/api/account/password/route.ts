import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import { MAX_PASSWORD_LENGTH, validatePassword } from "@/lib/password-policy";

const schema = z.object({
  newPassword: z.string().max(MAX_PASSWORD_LENGTH),
});

/**
 * POST /api/account/password — set your own password (first-login change
 * after a temporary password, or a routine change). Clears the
 * mustChangePassword flag.
 */
export const POST = handleApi(async (req: NextRequest) => {
  const user = await requireUser();
  const body = schema.parse(await req.json());
  const problem = validatePassword(body.newPassword, { email: user.email, name: user.name });
  if (problem) throw new ApiError(400, problem);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await bcrypt.hash(body.newPassword, 10),
      mustChangePassword: false,
    },
  });

  await audit({
    entityType: "User",
    entityId: user.id,
    actorId: user.id,
    actorName: user.name,
    action: "PASSWORD_CHANGED",
  });

  return NextResponse.json({ ok: true });
});
