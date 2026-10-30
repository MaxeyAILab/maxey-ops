import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push";
import { resolveContext } from "@/lib/notification-resolve";
import { eventExplicitTitle, eventFor, eventTitle, isQuietNow, selectRecipients, type RecipientUser } from "@/lib/notification-rules";

/**
 * Turns one recorded action into notifications. Every recipient gets an entry in their in-app inbox (the bell), and a phone
 * alert when they have turned notifications on, haven't muted that category and aren't in their quiet hours. It never throws
 * and gives up after a few seconds: a notification problem must never break the action that caused it.
 */

const BUDGET_MS = 6000;

export interface AuditEventInput {
  entityType: string;
  entityId: string;
  actorId?: string | null;
  actorName: string;
  action: string;
  diff?: unknown;
}

export async function dispatchAuditEvent(a: AuditEventInput): Promise<void> {
  const def = eventFor(a.action);
  if (!def) return; // most actions (clock-ins, logins, small edits) deliberately don't notify
  try {
    await Promise.race([run(a, def), new Promise<void>((resolve) => setTimeout(resolve, BUDGET_MS))]);
  } catch (err) {
    console.error("[notify] dispatch failed", a.action, err);
  }
}

async function run(a: AuditEventInput, def: NonNullable<ReturnType<typeof eventFor>>) {
  const base = await resolveContext(a.entityType, a.entityId, a.action, a.diff);
  if (!base) return;
  const ctx = { ...base, actorName: a.actorName };

  const [users, crew] = await Promise.all([
    prisma.user.findMany({
      where: { active: true, role: { not: "CLIENT" } },
      select: { id: true, role: true, department: true, customMenus: true, useCustomMenus: true, canApprovePettyCash: true, canReleasePettyCash: true, canManageCash: true, canApproveTallyOut: true },
    }),
    ctx.projectId ? prisma.projectAssignment.findMany({ where: { projectId: ctx.projectId, active: true }, select: { userId: true } }) : Promise.resolve([]),
  ]);
  const recipients = selectRecipients(def, ctx, users as RecipientUser[], new Set(crew.map((c) => c.userId)), a.actorId ?? null);
  if (recipients.length === 0) return;

  const prefs = await prisma.notificationPref.findMany({ where: { userId: { in: recipients.map((r) => r.userId) } } });
  const prefOf = new Map(prefs.map((p) => [p.userId, p]));
  const now = new Date();
  const tag = `${a.action}:${a.entityId}`;

  const deliver = recipients.filter((r) => !(prefOf.get(r.userId)?.muted ?? []).includes(def.category)); // a muted category is not delivered at all
  if (deliver.length === 0) return;

  const items = deliver.map((r) => {
    const title = r.explicit ? eventExplicitTitle(def, ctx) : eventTitle(def, ctx);
    return {
      userId: r.userId,
      category: def.category,
      title,
      body: def.body ? def.body(ctx) : "Tap to open",
      url: r.explicit && ctx.explicitUrl ? ctx.explicitUrl : ctx.url,
    };
  });
  await prisma.appNotification.createMany({ data: items });

  await Promise.allSettled(
    items
      .filter((i) => !isQuietNow(prefOf.get(i.userId), now))
      .map((i) => sendPushToUser(i.userId, { title: i.title, body: i.body, url: i.url, tag, category: i.category }))
  );
}
