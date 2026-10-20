import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import { sendPushToUser } from "@/lib/push";

/** POST /api/push/test — send the signed-in person a test notification on every phone they've turned notifications on for. */
export const POST = handleApi(async () => {
  const user = await requireUser();
  if (user.role === "CLIENT") throw new ApiError(403, "Not authorized");
  const devices = await prisma.pushSubscription.count({ where: { userId: user.id } });
  if (devices === 0) throw new ApiError(409, "Turn notifications on for this phone first");
  const result = await sendPushToUser(user.id, { title: "Maxey Ops test notification", body: "If you can read this, phone alerts are working. Tap to open.", url: "/notifications", tag: "test", category: "SYSTEM" });
  if (result.sent === 0) throw new ApiError(502, "The notification couldn't be delivered — try turning notifications off and on again");
  return NextResponse.json({ ok: true, ...result });
});
