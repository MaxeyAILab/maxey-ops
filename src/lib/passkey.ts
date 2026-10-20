import crypto from "node:crypto";
import { NextResponse } from "next/server";

/**
 * Fingerprint / Face ID sign-in (passkeys, the WebAuthn standard). The phone keeps the private key behind its fingerprint
 * or face check; the server keeps only the public half and checks a fresh signature every time. Nothing here is a password.
 */
export const RP_NAME = "Maxey Ops";
export const CHALLENGE_COOKIE = "maxey_pk";
export const CHALLENGE_TTL_MS = 5 * 60_000;
export const TICKET_TTL_MS = 60_000;

/** The site's own address, which the passkey is bound to — a passkey made here can't be used on any look-alike site. */
export function relyingParty(): { rpID: string; origin: string } {
  const base = new URL(process.env.NEXTAUTH_URL || "http://localhost:3000");
  return { rpID: base.hostname, origin: base.origin };
}

function secret(): string {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("NEXTAUTH_SECRET is not set");
  return s;
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

/** A tamper-proof token: the payload plus an HMAC signature made with the site's secret. */
export function signPayload(payload: Record<string, unknown>): string {
  const body = b64(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

/** The payload if the signature is genuine and it hasn't expired, else null. */
export function readPayload<T extends { exp: number }>(token: string | undefined | null, now = Date.now()): T | null {
  if (!token || token.length > 2000) return null;
  const [body, sig, ...rest] = token.split(".");
  if (!body || !sig || rest.length) return null;
  const want = crypto.createHmac("sha256", secret()).update(body).digest();
  let got: Buffer;
  try {
    got = Buffer.from(sig, "base64url");
  } catch {
    return null;
  }
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
    return typeof payload.exp === "number" && payload.exp > now ? payload : null;
  } catch {
    return null;
  }
}

export interface ChallengePayload {
  purpose: "register" | "login";
  challenge: string;
  /** who is registering (login challenges belong to nobody yet) */
  uid?: string;
  exp: number;
}

/** Remember a challenge between "here are the options" and "here is the phone's answer" in a short-lived signed cookie. */
export function withChallenge(res: NextResponse, c: Omit<ChallengePayload, "exp">): NextResponse {
  res.cookies.set(CHALLENGE_COOKIE, signPayload({ ...c, exp: Date.now() + CHALLENGE_TTL_MS }), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/api/passkey",
    maxAge: CHALLENGE_TTL_MS / 1000,
  });
  return res;
}

export const clearChallenge = (res: NextResponse): NextResponse => {
  res.cookies.set(CHALLENGE_COOKIE, "", { path: "/api/passkey", maxAge: 0 });
  return res;
};

export interface LoginTicket {
  typ: "passkey-login";
  uid: string;
  /** the session id written to the account when the fingerprint check passed; redeeming the ticket swaps it for a new one, so a ticket works once */
  sid: string;
  exp: number;
}

export const newSessionId = () => crypto.randomBytes(24).toString("hex");
