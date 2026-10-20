import { NextResponse } from "next/server";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import { getVapid } from "@/lib/push";

export const dynamic = "force-dynamic";

/** GET /api/push/key — the public key a phone needs to subscribe to this app's notifications. Signed-in staff only. */
export const GET = handleApi(async () => {
  const user = await requireUser();
  if (user.role === "CLIENT") throw new ApiError(403, "Not authorized");
  const { publicKey } = await getVapid();
  return NextResponse.json({ publicKey });
});
