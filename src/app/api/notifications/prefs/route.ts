import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import { ALL_CATEGORIES, eligibleCategories, type RecipientUser } from "@/lib/notification-rules";

const prefSchema = z.object({
  muted: z.array(z.string()).max(20),
  quietStart: z.number().int().min(0).max(23).nullable(),
  quietEnd: z.number().int().min(0).max(23).nullable(),
});

/** PUT /api/notifications/prefs — save which categories you've muted and your quiet hours (no phone alerts, Manila time). */
export const PUT = handleApi(async (req: NextRequest) => {
  const user = await requireUser();
  if (user.role === "CLIENT") throw new ApiError(403, "Not authorized");
  const body = prefSchema.parse(await req.json());
  if ((body.quietStart == null) !== (body.quietEnd == null)) throw new ApiError(400, "Set both a start and an end for quiet hours, or neither");

  const me = (await prisma.user.findUnique({
    where: { id: user.id },
    select: { id: true, role: true, department: true, customMenus: true, useCustomMenus: true, canApprovePettyCash: true, canReleasePettyCash: true, canManageCash: true },
  })) as RecipientUser;
  // Only categories the person can actually be told about can be muted.
  const allowed = new Set<string>(eligibleCategories(me));
  const muted = Array.from(new Set(body.muted)).filter((c) => (ALL_CATEGORIES as string[]).includes(c) && allowed.has(c));

  await prisma.notificationPref.upsert({
    where: { userId: user.id },
    update: { muted, quietStart: body.quietStart, quietEnd: body.quietEnd },
    create: { userId: user.id, muted, quietStart: body.quietStart, quietEnd: body.quietEnd },
  });
  return NextResponse.json({ ok: true, muted });
});
