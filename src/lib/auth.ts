import type { NextAuthOptions } from "next-auth";
import { getServerSession } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
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
  /** Single-device login tag (every role but OWNER) — undefined for Owner,
   * who is exempt and may be signed in on multiple devices at once. */
  sessionId?: string;
}

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
      async authorize(credentials) {
        if (!credentials?.email || !credentials.password) return null;
        const user = await prisma.user.findUnique({
          where: { email: credentials.email.toLowerCase().trim() },
        });
        if (!user || !user.active) return null;
        const ok = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!ok) return null;

        // Single-device login (every role but Owner, per business rule —
        // shared/simultaneous logins were driving load concerns). Each
        // successful login overwrites currentSessionId, so whatever session
        // a previous device was holding stops matching on its next request
        // and getSessionUser() treats it as signed out.
        let sessionId: string | undefined;
        if (user.role !== "OWNER") {
          sessionId = crypto.randomBytes(24).toString("hex");
          await prisma.user.update({ where: { id: user.id }, data: { currentSessionId: sessionId } });
        }

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
 * login: every role but Owner is logged out the instant a newer login
 * elsewhere has overwritten currentSessionId.
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
      currentSessionId: true,
    },
  });
  if (!dbUser?.active) return null;
  if (dbUser.role !== "OWNER" && dbUser.currentSessionId !== su.sessionId) {
    return null; // signed in from another device since this session started
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
  };
}
