import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push";
import { isQuietNow } from "@/lib/notification-rules";

/**
 * Tells specific people something: an entry in each person's in-app inbox (the bell) and a phone alert when they have turned
 * notifications on, haven't muted the category and aren't in their quiet hours — the same delivery rules as every other alert,
 * for the cases where the audience is a set of named people (the foreman of a project, its engineer…) rather than a role.
 * Never throws and never waits long: a notification problem must not break the action that caused it.
 */
export interface PeopleAlert {
  category: string;
  title: string;
  body: string;
  url: string;
  /** replaces an earlier phone alert with the same tag instead of piling up */
  tag?: string;
}

export async function notifyPeople(userIds: string[], alert: PeopleAlert): Promise<number> {
  const ids = Array.from(new Set(userIds));
  if (ids.length === 0) return 0;
  try {
    const run = async () => {
      const [users, prefs] = await Promise.all([
        prisma.user.findMany({ where: { id: { in: ids }, active: true, role: { not: "CLIENT" } }, select: { id: true } }),
        prisma.notificationPref.findMany({ where: { userId: { in: ids } } }),
      ]);
      const prefOf = new Map(prefs.map((p) => [p.userId, p]));
      const deliver = users.filter((u) => !(prefOf.get(u.id)?.muted ?? []).includes(alert.category));
      if (deliver.length === 0) return 0;
      await prisma.appNotification.createMany({ data: deliver.map((u) => ({ userId: u.id, category: alert.category, title: alert.title, body: alert.body, url: alert.url })) });
      const now = new Date();
      await Promise.allSettled(
        deliver.filter((u) => !isQuietNow(prefOf.get(u.id), now)).map((u) => sendPushToUser(u.id, { title: alert.title, body: alert.body, url: alert.url, tag: alert.tag, category: alert.category }))
      );
      return deliver.length;
    };
    return await Promise.race([run(), new Promise<number>((resolve) => setTimeout(() => resolve(0), 6000))]);
  } catch (err) {
    console.error("[notifyPeople]", err);
    return 0;
  }
}
