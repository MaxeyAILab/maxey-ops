/**
 * Notification dispatch (Spec §8): push primary, SMS fallback, email.
 * Email sends via Resend (https://resend.com) when RESEND_API_KEY is set —
 * a plain fetch call, no SDK dependency needed for one endpoint. Falls back
 * to console logging when the key is absent (local dev without a key, or
 * SMS, which is still unwired) or if the Resend call itself fails, so a
 * notification failure never breaks the caller's request.
 */

interface Notification {
  to: { name: string; phone?: string | null; email?: string | null };
  subject: string;
  message: string;
}

const RESEND_API_KEY = process.env.RESEND_API_KEY;
// Resend's shared sandbox sender works without verifying a domain, but in
// sandbox mode Resend only delivers to the email address the account was
// created with. Verify a domain (e.g. maxeyconstruction.ph) in the Resend
// dashboard and set RESEND_FROM_EMAIL to unlock sending to anyone.
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "Maxey Construction <onboarding@resend.dev>";

async function sendEmail(to: string, subject: string, text: string): Promise<boolean> {
  if (!RESEND_API_KEY) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, text }),
    });
    if (!res.ok) {
      console.error("[notify] Resend error", res.status, await res.text().catch(() => ""));
      return false;
    }
    return true;
  } catch (err) {
    console.error("[notify] Resend request failed", err);
    return false;
  }
}

export async function notify(n: Notification): Promise<void> {
  // TODO(providers): Semaphore SMS via SEMAPHORE_API_KEY
  const emailed = n.to.email ? await sendEmail(n.to.email, n.subject, n.message) : false;
  if (!emailed) {
    console.log(`[notify] to=${n.to.name} subject="${n.subject}" msg="${n.message}"`);
  }
}

export async function notifyOwner(subject: string, message: string): Promise<void> {
  await notify({ to: { name: "Owner" }, subject, message });
}
