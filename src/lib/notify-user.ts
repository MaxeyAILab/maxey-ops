import { prisma } from "@/lib/prisma";
import { notify } from "@/lib/notify";

/**
 * Email one staff member through the existing notification helper (Resend when its key is set,
 * otherwise a console line). Messages deliberately carry no sensitive detail — they say that
 * something needs attention and point back to the app, which is where permissions are enforced.
 * Never throws: a failed notification must not break the action that triggered it.
 */
export async function notifyUser(userId: string, subject: string, message: string): Promise<void> {
  try {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true, phone: true, active: true } });
    if (!u || !u.active) return;
    await notify({ to: { name: u.name, email: u.email, phone: u.phone }, subject, message });
  } catch (err) {
    console.error("[notifyUser]", err);
  }
}
