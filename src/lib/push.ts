import webpush from "web-push";
import { prisma } from "@/lib/prisma";

/**
 * Sending to phones. Browsers and phones receive notifications through the maker's push service (Google, Apple,
 * Mozilla) — free. To prove a message really comes from this app the server signs it with a key pair (VAPID). The pair is
 * created once, the first time it is needed, and kept in the database, so there is nothing to configure; setting
 * VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY in the environment overrides it. Changing the pair later would make every phone
 * subscribe again.
 */

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag?: string;
  category?: string;
}

let cached: { publicKey: string; privateKey: string } | null = null;

export async function getVapid(): Promise<{ publicKey: string; privateKey: string }> {
  if (cached) return cached;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    cached = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
    return cached;
  }
  let row = await prisma.pushConfig.findUnique({ where: { id: "singleton" } });
  if (!row) {
    const keys = webpush.generateVAPIDKeys();
    // Two first requests at once can't make two different pairs: the second insert is skipped and both read the winner.
    await prisma.pushConfig.createMany({ data: [{ id: "singleton", publicKey: keys.publicKey, privateKey: keys.privateKey }], skipDuplicates: true });
    row = await prisma.pushConfig.findUniqueOrThrow({ where: { id: "singleton" } });
  }
  cached = { publicKey: row.publicKey, privateKey: row.privateKey };
  return cached;
}

// The push standard only accepts an https: or mailto: contact address, so a local http:// address falls back to the live site.
const subject = () => [process.env.VAPID_SUBJECT, process.env.NEXTAUTH_URL].find((s) => s && /^(https:\/\/|mailto:)/.test(s)) ?? "https://maxey-ops.vercel.app";

export interface SendResult {
  sent: number;
  removed: number;
  failed: number;
}

/** Send one notification to every phone/browser a person has subscribed. Never throws. Dead subscriptions are cleaned up. */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<SendResult> {
  const result: SendResult = { sent: 0, removed: 0, failed: 0 };
  try {
    const subs = await prisma.pushSubscription.findMany({ where: { userId } });
    if (subs.length === 0) return result;
    const vapid = await getVapid();
    const options = { vapidDetails: { subject: subject(), publicKey: vapid.publicKey, privateKey: vapid.privateKey }, TTL: 60 * 60 * 24, urgency: "normal" as const, timeout: 4000 };
    const body = JSON.stringify(payload);
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, options);
          result.sent++;
          await prisma.pushSubscription.update({ where: { id: s.id }, data: { lastSuccessAt: new Date() } }).catch(() => undefined);
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            // The phone says this subscription no longer exists (app removed, permission revoked).
            await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => undefined);
            result.removed++;
          } else {
            result.failed++;
            console.error("[push] send failed", status ?? "", (err as Error).message);
          }
        }
      })
    );
  } catch (err) {
    console.error("[push] sendPushToUser", err);
  }
  return result;
}
