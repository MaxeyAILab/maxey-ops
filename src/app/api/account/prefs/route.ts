import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import { allowedMenus, canUseCashExpense } from "@/lib/access";
import { LANG_COOKIE } from "@/lib/i18n";

const schema = z.object({
  language: z.enum(["en", "fil"]).optional(),
  /** Tabs for the phone's bottom bar; an empty list goes back to the default for the person's role. */
  mobileTabs: z.array(z.string().max(60)).max(5).optional(),
});

/** PUT /api/account/prefs — save the signed-in person's language and bottom-bar tabs. */
export const PUT = handleApi(async (req: NextRequest) => {
  const user = await requireUser();
  if (user.role === "CLIENT") throw new ApiError(403, "Not authorized");
  const body = schema.parse(await req.json());

  const data: { language?: string; mobileTabs?: string[] } = {};
  if (body.language) data.language = body.language;
  if (body.mobileTabs) {
    const allowed = new Set([...allowedMenus(user.role, user.department, user.customMenus, user.useCustomMenus), ...(canUseCashExpense(user) ? ["/cash-expense"] : [])]);
    const tabs = Array.from(new Set(body.mobileTabs));
    if (tabs.length > 0 && (tabs.length < 2 || tabs.length > 5)) throw new ApiError(400, "Pick between 2 and 5 tabs");
    if (tabs.some((t) => !allowed.has(t))) throw new ApiError(400, "One of those tabs isn't available to you");
    data.mobileTabs = tabs;
  }

  await prisma.userPref.upsert({
    where: { userId: user.id },
    update: data,
    create: { userId: user.id, mobileTabs: data.mobileTabs ?? [], language: data.language ?? "en" },
  });

  const res = NextResponse.json({ ok: true });
  if (body.language) res.cookies.set(LANG_COOKIE, body.language, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  return res;
});
