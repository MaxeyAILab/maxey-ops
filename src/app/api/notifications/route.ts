import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import { ALL_CATEGORIES } from "@/lib/notification-rules";

export const dynamic = "force-dynamic";

/** How many unread, in total and per kind (what the bell and the bottom-bar numbers show). */
async function unreadSummary(userId: string) {
  const rows = await prisma.appNotification.groupBy({ by: ["category"], where: { userId, readAt: null }, _count: { _all: true } });
  const byCategory = Object.fromEntries(rows.map((r) => [r.category, r._count._all]));
  return { unread: rows.reduce((s, r) => s + r._count._all, 0), byCategory };
}

/**
 * GET /api/notifications — the signed-in person's inbox (newest first) and how many are unread. With ?summary=1 only the
 * unread numbers come back (cheap enough for the phone to ask every minute).
 */
export const GET = handleApi(async (req: NextRequest) => {
  const user = await requireUser();
  if (user.role === "CLIENT") throw new ApiError(403, "Not authorized");
  const summary = await unreadSummary(user.id);
  if (req.nextUrl.searchParams.get("summary")) return NextResponse.json(summary);
  const items = await prisma.appNotification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 50 });
  return NextResponse.json({ items, ...summary });
});

const readSchema = z.union([
  z.object({ all: z.literal(true) }),
  z.object({ ids: z.array(z.string()).min(1).max(100) }),
  // everything new in the tab(s) the person just opened
  z.object({ categories: z.array(z.string()).min(1).max(12) }),
]);

/** POST /api/notifications — mark some, or all, of your own notifications as read. */
export const POST = handleApi(async (req: NextRequest) => {
  const user = await requireUser();
  if (user.role === "CLIENT") throw new ApiError(403, "Not authorized");
  const body = readSchema.parse(await req.json());
  const known = new Set<string>(ALL_CATEGORIES);
  const scope =
    "ids" in body ? { id: { in: body.ids } } : "categories" in body ? { category: { in: body.categories.filter((c) => known.has(c)) } } : {};
  const res = await prisma.appNotification.updateMany({ where: { userId: user.id, readAt: null, ...scope }, data: { readAt: new Date() } });
  return NextResponse.json({ ok: true, marked: res.count });
});
