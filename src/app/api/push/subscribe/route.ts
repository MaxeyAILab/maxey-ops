import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";

const MAX_DEVICES_PER_PERSON = 8;

const subscribeSchema = z.object({
  endpoint: z.string().url().max(1000).refine((u) => u.startsWith("https://") || /^http:\/\/localhost(:\d+)?\//.test(u), "The push address must be https"),
  keys: z.object({ p256dh: z.string().min(10).max(300), auth: z.string().min(10).max(100) }),
  userAgent: z.string().max(300).optional(),
});

/**
 * POST /api/push/subscribe — this phone/browser turns notifications on for the signed-in person. A subscription belongs to
 * whoever last turned it on: if another person signs in on the same phone and turns it on, it moves to them, so the first
 * person's alerts can never keep arriving on someone else's phone.
 */
export const POST = handleApi(async (req: NextRequest) => {
  const user = await requireUser();
  if (user.role === "CLIENT") throw new ApiError(403, "Not authorized");
  const body = subscribeSchema.parse(await req.json());

  await prisma.pushSubscription.upsert({
    where: { endpoint: body.endpoint },
    update: { userId: user.id, p256dh: body.keys.p256dh, auth: body.keys.auth, userAgent: body.userAgent ?? null },
    create: { userId: user.id, endpoint: body.endpoint, p256dh: body.keys.p256dh, auth: body.keys.auth, userAgent: body.userAgent ?? null },
  });

  // Keep a sensible cap per person: forget the oldest devices beyond it.
  const mine = await prisma.pushSubscription.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, select: { id: true } });
  if (mine.length > MAX_DEVICES_PER_PERSON) {
    await prisma.pushSubscription.deleteMany({ where: { id: { in: mine.slice(MAX_DEVICES_PER_PERSON).map((m) => m.id) } } });
  }
  return NextResponse.json({ ok: true, devices: Math.min(mine.length, MAX_DEVICES_PER_PERSON) });
});

/** DELETE /api/push/subscribe — turn notifications off on this phone/browser (also done automatically on sign-out). */
export const DELETE = handleApi(async (req: NextRequest) => {
  const user = await requireUser();
  const { endpoint } = z.object({ endpoint: z.string().max(1000) }).parse(await req.json());
  // Only ever removes the caller's own device.
  await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: user.id } });
  return NextResponse.json({ ok: true });
});
