import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { handleApi, requireUser } from "@/lib/rbac";

/** DELETE /api/passkey/:id — remove one of your own fingerprint / Face ID devices. */
export const DELETE = handleApi(async (_req: Request, { params }: { params: { id: string } }) => {
  const user = await requireUser();
  const gone = await prisma.passkey.deleteMany({ where: { id: params.id, userId: user.id } });
  if (gone.count) await audit({ entityType: "User", entityId: user.id, actorId: user.id, actorName: user.name, action: "PASSKEY_REMOVED", diff: {} });
  return NextResponse.json({ ok: true });
});
