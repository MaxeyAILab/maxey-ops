import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { allowedMenus, canUseCashExpense } from "@/lib/access";
import { NAV, tabInfo } from "@/lib/nav-items";
import { CASH_TAB, defaultTabs, resolveTabs } from "@/lib/mobile-tabs";
import { fmtDateTime } from "@/lib/format";
import { getT } from "@/lib/i18n-server";
import { MySettings } from "@/components/my-settings";
import { eligibleQuick, resolveQuick } from "@/lib/quick-actions";
import { quickAccessFor } from "@/lib/quick-access";

export const metadata = { title: "My settings" };
export const dynamic = "force-dynamic";

/** Each person's own phone settings: the tabs on their bottom bar, language, vibration, fingerprint / Face ID. */
export default async function SettingsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role === "CLIENT") redirect("/portal");
  const t = getT();

  const menus = allowedMenus(user.role, user.department, user.customMenus, user.useCustomMenus);
  const available = [...NAV.filter((n) => menus.includes(n.href)).map((n) => n.href), ...(canUseCashExpense(user) ? [CASH_TAB] : [])];
  const [pref, passkeys] = await Promise.all([
    prisma.userPref.findUnique({ where: { userId: user.id }, select: { mobileTabs: true, quickActions: true } }),
    prisma.passkey.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" }, select: { id: true, label: true, createdAt: true, lastUsedAt: true } }),
  ]);

  const tabs = available.flatMap((href) => {
    const info = tabInfo(href);
    return info ? [{ href, label: t(info.labelKey), icon: info.icon }] : [];
  });
  const defaults = defaultTabs(user.role, available);
  const usingDefault = !pref?.mobileTabs?.length;
  const chosen = resolveTabs(pref?.mobileTabs, user.role, available);

  // the + button
  const eligible = eligibleQuick((await quickAccessFor(user)).access);
  const quick = {
    options: eligible.map((q) => ({ key: q.key, label: t(q.labelKey), icon: q.icon })),
    chosen: resolveQuick(pref?.quickActions, eligible).map((q) => q.key),
    defaults: resolveQuick([], eligible).map((q) => q.key),
    usingDefault: !pref?.quickActions?.length,
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-ink-900">{t("settings.title")}</h1>
        <p className="text-sm text-ink-500">
          {user.name} · {user.email}
        </p>
      </div>
      <MySettings
        tabs={tabs}
        chosen={chosen}
        defaults={defaults}
        usingDefault={usingDefault}
        quick={quick}
        passkeys={passkeys.map((p) => ({ id: p.id, label: p.label, added: fmtDateTime(p.createdAt), lastUsed: p.lastUsedAt ? fmtDateTime(p.lastUsedAt) : null }))}
      />
    </div>
  );
}
