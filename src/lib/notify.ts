/**
 * Notification dispatch (Spec §8): push primary, SMS fallback, email.
 * Phase 1 ships with console logging; wire Semaphore (SMS) and Resend (email)
 * by filling the env keys — the call sites are already in place.
 */

interface Notification {
  to: { name: string; phone?: string | null; email?: string | null };
  subject: string;
  message: string;
}

export async function notify(n: Notification): Promise<void> {
  // TODO(providers): Semaphore SMS via SEMAPHORE_API_KEY, Resend email via RESEND_API_KEY
  console.log(`[notify] to=${n.to.name} subject="${n.subject}" msg="${n.message}"`);
}

export async function notifyOwner(subject: string, message: string): Promise<void> {
  await notify({ to: { name: "Owner" }, subject, message });
}
