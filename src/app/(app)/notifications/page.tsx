import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fmtDateTime } from "@/lib/format";
import { CATEGORY_LABEL, eligibleCategories, type RecipientUser } from "@/lib/notification-rules";
import { NotificationInbox } from "@/components/notification-inbox";
import { NotificationSettings } from "@/components/notification-settings";

export const metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

/** Your bell: phone-alert settings, what you are told about, and the list of everything you have been told. */
export default async function NotificationsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role === "CLIENT") redirect("/portal");

  const [me, pref, items] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { id: true, role: true, department: true, customMenus: true, useCustomMenus: true, canApprovePettyCash: true, canReleasePettyCash: true, canManageCash: true },
    }),
    prisma.notificationPref.findUnique({ where: { userId: user.id } }),
    prisma.appNotification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  const muted = new Set(pref?.muted ?? []);
  const categories = eligibleCategories(me as RecipientUser).map((c) => ({ key: c, label: CATEGORY_LABEL[c], muted: muted.has(c) }));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-ink-900">Notifications</h1>
        <p className="text-sm text-ink-500">
          Get a phone alert whenever something you are involved in is updated — requisitions, purchasing, deliveries, cash, projects and more, depending on your role.
        </p>
      </div>
      <NotificationSettings categories={categories} quietStart={pref?.quietStart ?? null} quietEnd={pref?.quietEnd ?? null} />
      <NotificationInbox items={items.map((n) => ({ id: n.id, title: n.title, body: n.body, url: n.url, when: fmtDateTime(n.createdAt), unread: n.readAt == null }))} />
    </div>
  );
}
