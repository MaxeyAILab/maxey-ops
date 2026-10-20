import type { NextAuthOptions } from "next-auth";
import { getServerSession } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { clearAttempts, beginAttempt, failAttempt } from "@/lib/login-guard";
import { clientIp, lockedError } from "@/lib/login-throttle";
import { newSessionId, readPayload, type LoginTicket } from "@/lib/passkey";
import type { Department, Role } from "@prisma/client";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  department: Department | null;
  clientId: string | null;
  mustChangePassword: boolean;
  useCustomMenus: boolean;
  customMenus: string[];
  /** The Owner has allowed this person to raise requisitions (see canRaiseRequisition). */
  canRequisition: boolean;
  /** The Owner has switched this person on to approve / to release petty cash (People page). */
  canApprovePettyCash: boolean;
  canReleasePettyCash: boolean;
  /** Full Cash Expense access, as Accounting has it (People page switch). */
  canManageCash: boolean;
  /** Single-device login tag, set for every role including the Owner. */
  sessionId?: string;
}

// Compared against when the email isn't an account, so a missing account takes as long to refuse as a wrong password
// does — otherwise response time would reveal which emails are registered.
let dummyHash: string | null = null;

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "Email & Password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials.password) return null;

        // Lockout: every attempt is recorded before the password is checked. Too many wrong passwords
        // for an email from one place (or for one email / from one place overall) pauses sign-in for
        // about 15 minutes — see src/lib/login-throttle.ts. The check applies to emails that don't
        // exist too, so a lock can't be used to find out which emails are registered.
        const attempt = await beginAttempt("LOGIN", credentials.email, clientIp(req?.headers?.["x-forwarded-for"]));
        if (attempt.blocked) throw new Error(lockedError(attempt.blocked.minutes));

        const user = await prisma.user.findUnique({
          where: { email: credentials.email.toLowerCase().trim() },
        });
        if (!user || !user.active) {
          dummyHash ??= await bcrypt.hash("not-a-real-account", 10);
          await bcrypt.compare(credentials.password, dummyHash);
          await failAttempt(attempt);
          return null;
        }
        const ok = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!ok) {
          await failAttempt(attempt);
          return null;
        }
        await clearAttempts(attempt);

        // Single-device login — every role, the Owner included. Each successful login
        // overwrites currentSessionId, so whatever session a previous device was holding
        // stops matching on its next request and getSessionUser() treats it as signed out.
        const sessionId = crypto.randomBytes(24).toString("hex");
        await prisma.user.update({ where: { id: user.id }, data: { currentSessionId: sessionId } });

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          clientId: user.clientId,
          sessionId,
        } as never;
      },
    }),
    // Fingerprint / Face ID: the sign-in page first proves the passkey to /api/passkey/login/verify, which hands back a
    // one-minute signed ticket; redeeming it here starts the very same kind of session a password does.
    CredentialsProvider({
      id: "passkey",
      name: "Fingerprint / Face ID",
      credentials: { ticket: { label: "Ticket", type: "text" } },
      async authorize(credentials) {
        const ticket = readPayload<LoginTicket>(credentials?.ticket);
        if (!ticket || ticket.typ !== "passkey-login") return null;
        const user = await prisma.user.findUnique({ where: { id: ticket.uid } });
        if (!user || !user.active || user.role === "CLIENT") return null;
        // A ticket works once: it only matches while the session id it carries is still the account's current one,
        // and redeeming swaps in a new id (so a copied ticket is dead the moment the real one is used).
        const sessionId = newSessionId();
        const swapped = await prisma.user.updateMany({ where: { id: user.id, currentSessionId: ticket.sid }, data: { currentSessionId: sessionId } });
        if (swapped.count !== 1) return null;
        return { id: user.id, name: user.name, email: user.email, role: user.role, clientId: user.clientId, sessionId } as never;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = (user as never as SessionUser).id;
        token.role = (user as never as SessionUser).role;
        token.clientId = (user as never as SessionUser).clientId;
        token.sessionId = (user as never as SessionUser).sessionId;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as never as SessionUser).id = token.id as string;
        (session.user as never as SessionUser).role = token.role as Role;
        (session.user as never as SessionUser).clientId =
          (token.clientId as string | null) ?? null;
        (session.user as never as SessionUser).sessionId = token.sessionId as string | undefined;
      }
      return session;
    },
  },
};

/**
 * Server-side session user, or null. Cross-checks the database on every call
 * so a deactivated account (client after turnover, resigned staff) loses
 * access immediately — not just at next login — and so password-change state
 * is always fresh. This is also the enforcement point for single-device
 * login: every role, the Owner included, is logged out the instant a newer
 * login elsewhere (or a password reset) has overwritten currentSessionId.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return null;
  const su = session.user as never as SessionUser;
  const dbUser = await prisma.user.findUnique({
    where: { id: su.id },
    select: {
      active: true,
      mustChangePassword: true,
      role: true,
      department: true,
      clientId: true,
      name: true,
      useCustomMenus: true,
      customMenus: true,
      canRequisition: true,
      canApprovePettyCash: true,
      canReleasePettyCash: true,
      canManageCash: true,
      currentSessionId: true,
    },
  });
  if (!dbUser?.active) return null;
  if (!dbUser.currentSessionId || dbUser.currentSessionId !== su.sessionId) {
    return null; // signed in from another device (or the password was reset) since this session started
  }
  return {
    ...su,
    name: dbUser.name,
    role: dbUser.role,
    department: dbUser.department,
    clientId: dbUser.clientId,
    mustChangePassword: dbUser.mustChangePassword,
    useCustomMenus: dbUser.useCustomMenus,
    customMenus: dbUser.customMenus,
    canRequisition: dbUser.canRequisition,
    canApprovePettyCash: dbUser.canApprovePettyCash,
    canReleasePettyCash: dbUser.canReleasePettyCash,
    canManageCash: dbUser.canManageCash,
  };
}
