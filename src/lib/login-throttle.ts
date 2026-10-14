/**
 * Sign-in protection rules — pure, so they can be tested without a database.
 *
 * Three limits, each over a sliding 15-minute window of failed attempts:
 *  - one person at one place: 5 wrong tries for an email from one address, then that
 *    combination is locked. A thief guessing from their own address therefore can't
 *    lock the real owner out when the owner signs in from somewhere else.
 *  - one email, from anywhere: 25 wrong tries, then the account is locked for everyone
 *    (guessing spread across many addresses).
 *  - one address, any email: 25 wrong tries, then that address is blocked (trying many
 *    accounts from one place).
 */
export const WINDOW_MINUTES = 15;
export const WINDOW_MS = WINDOW_MINUTES * 60 * 1000;
export const MAX_FAILS_PER_EMAIL_AND_IP = 5;
export const MAX_FAILS_PER_EMAIL = 25;
export const MAX_FAILS_PER_IP = 25;

/** Attempt rows older than this are deleted. */
export const RETENTION_MS = 24 * 60 * 60 * 1000;

export type ThrottleReason = "pair" | "email" | "ip";

export interface ThrottleCounts {
  /** Failed (or in-flight) attempts in the window, this very attempt included. */
  pair: number;
  email: number;
  ip: number;
}

/** Whether this attempt is over a limit. The counts include the attempt being judged, so ">" is the test. */
export function throttleReason(counts: ThrottleCounts): ThrottleReason | null {
  if (counts.pair > MAX_FAILS_PER_EMAIL_AND_IP) return "pair";
  if (counts.email > MAX_FAILS_PER_EMAIL) return "email";
  if (counts.ip > MAX_FAILS_PER_IP) return "ip";
  return null;
}

/**
 * How long until the oldest counted failure leaves the window and the lock eases,
 * rounded up to a whole minute and never less than 1 so the message is never "0 minutes".
 */
export function minutesUntilUnlocked(oldestCountedFailure: Date | null, now: Date): number {
  if (!oldestCountedFailure) return WINDOW_MINUTES;
  const msLeft = oldestCountedFailure.getTime() + WINDOW_MS - now.getTime();
  return Math.min(WINDOW_MINUTES, Math.max(1, Math.ceil(msLeft / 60_000)));
}

/** Best-effort client address from the proxy header; Vercel sets the first entry to the real client. */
export function clientIp(forwardedFor: string | string[] | null | undefined): string {
  const raw = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  const first = raw?.split(",")[0]?.trim();
  return first ? first.slice(0, 64) : "unknown";
}

/** Normalised email as recorded for throttling — also used for text that isn't a real address. */
export const throttleEmail = (raw: unknown): string => String(raw ?? "").toLowerCase().trim().slice(0, 254);

/** The error text the sign-in page reads. */
export const lockedError = (minutes: number) => `LOCKED:${minutes}`;
export const parseLockedError = (error: string | null | undefined): number | null => {
  const m = /^LOCKED:(\d{1,3})$/.exec(error ?? "");
  return m ? Number(m[1]) : null;
};
