import { NextRequest, NextResponse } from "next/server";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import { searchEverything } from "@/lib/search";

export const dynamic = "force-dynamic";

/** GET /api/search?q= — projects, requisitions, purchase orders and people matching what was typed, limited to what the person may open. */
export const GET = handleApi(async (req: NextRequest) => {
  const user = await requireUser();
  if (user.role === "CLIENT") throw new ApiError(403, "Not authorized");
  const groups = await searchEverything(user, req.nextUrl.searchParams.get("q") ?? "");
  return NextResponse.json({ groups });
});
