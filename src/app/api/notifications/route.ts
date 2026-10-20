import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";

export const dynamic = "force-dynamic";

/** GET /api/notifications — the signed-in person's inbox (newest first) and how many are unread. */
export const GET = handleApi(async () => {
  const user = await requireUser();
  if (user.role === "CLIENT") throw new ApiError(403, "Not authorized");
  const [items, unread] = await Promise.all([
    prisma.appNotification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.appNotification.count({ where: { userId: user.id, readAt: null } }),
  ]);
  return NextResponse.json({ items, unread });
});

const readSchema = z.union([z.object({ all: z.literal(true) }), z.object({ ids: z.array(z.string()).min(1).max(100) })]);

/** POST /api/notifications — mark some, or all, of your own notifications as read. */
export const POST = handleApi(async (req: NextRequest) => {
  const user = await requireUser();
  if (user.role === "CLIENT") throw new ApiError(403, "Not authorized");
  const body = readSchema.parse(await req.json());
  const where = { userId: user.id, readAt: null, ...("ids" in body ? { id: { in: body.ids } } : {}) };
  const res = await prisma.appNotification.updateMany({ where, data: { readAt: new Date() } });
  return NextResponse.json({ ok: true, marked: res.count });
});
