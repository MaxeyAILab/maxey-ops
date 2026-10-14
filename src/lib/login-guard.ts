import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { notifyOwner } from "@/lib/notify";
import { RETENTION_MS, WINDOW_MS, minutesUntilUnlocked, throttleEmail, throttleReason, type ThrottleReason } from "@/lib/login-throttle";

export type AttemptKind = "LOGIN" | "RESET";

export interface Attempt {
  id: string;
  email: string;
  ip: string;
  /** Set when this attempt is refused by the lockout — the password must not even be checked. */
  blocked: { reason: ThrottleReason; minutes: number } | null;
}

/**
 * Record an attempt BEFORE the password is checked and judge it against the limits. Counting first means a
 * burst of parallel guesses is counted as it arrives rather than slipping through together. A blocked
 * attempt is kept for the record but is not counted, so hammering a locked account can't extend the lock.
 */
export async function beginAttempt(kind: AttemptKind, rawEmail: unknown, ip: string): Promise<Attempt> {
  const email = throttleEmail(rawEmail);
  const now = new Date();
  const since = new Date(now.getTime() - WINDOW_MS);

  // Housekeeping on a small share of attempts, so the table doesn't grow without bound.
  if (Math.random() < 0.02) {
    await prisma.authAttempt.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - RETENTION_MS) } } }).catch(() => undefined);
  }

  const row = await prisma.authAttempt.create({ data: { kind, result: "PENDING", email, ip }, select: { id: true } });
  const counted = { kind, result: { in: ["PENDING", "FAIL"] as ("PENDING" | "FAIL")[] }, createdAt: { gte: since } };
  const [pair, emailCount, ipCount] = await Promise.all([
    prisma.authAttempt.count({ where: { ...counted, email, ip } }),
    prisma.authAttempt.count({ where: { ...counted, email } }),
    prisma.authAttempt.count({ where: { ...counted, ip } }),
  ]);
  const reason = throttleReason({ pair, email: emailCount, ip: ipCount });
  if (!reason) return { id: row.id, email, ip, blocked: null };

  await prisma.authAttempt.update({ where: { id: row.id }, data: { result: "BLOCKED" } });
  const scope = reason === "pair" ? { email, ip } : reason === "email" ? { email } : { ip };
  const oldest = await prisma.authAttempt.findFirst({ where: { ...counted, ...scope }, orderBy: { createdAt: "asc" }, select: { createdAt: true } });
  const minutes = minutesUntilUnlocked(oldest?.createdAt ?? null, now);

  // Tell the Owner once per lock, not on every refused attempt.
  const alreadyBlocked = await prisma.authAttempt.count({ where: { kind, result: "BLOCKED", createdAt: { gte: since }, email, ip, id: { not: row.id } } });
  if (alreadyBlocked === 0) {
    await audit({
      entityType: "Auth",
      entityId: email || "unknown",
      actorName: "system",
      action: kind === "LOGIN" ? "LOGIN_LOCKED" : "RESET_REQUESTS_LIMITED",
      diff: { ip, reason, minutes },
    }).catch(() => undefined);
    if (kind === "LOGIN") {
      await notifyOwner("Repeated failed sign-ins", `Too many wrong passwords for “${email || "(blank)"}” from ${ip}. Sign-in from there is paused for about ${minutes} minutes.`).catch(() => undefined);
    }
  }
  return { id: row.id, email, ip, blocked: { reason, minutes } };
}

export async function failAttempt(attempt: Attempt) {
  await prisma.authAttempt.update({ where: { id: attempt.id }, data: { result: "FAIL" } }).catch(() => undefined);
}

/** A correct password clears that person's failures from that address (failures from elsewhere stay on record). */
export async function clearAttempts(attempt: Attempt) {
  await prisma.authAttempt
    .deleteMany({ where: { kind: "LOGIN", email: attempt.email, ip: attempt.ip, result: { in: ["PENDING", "FAIL"] } } })
    .catch(() => undefined);
}
