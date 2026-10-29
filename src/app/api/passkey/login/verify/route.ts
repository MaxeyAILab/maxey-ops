import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { prisma } from "@/lib/prisma";
import { handleApi } from "@/lib/rbac";
import { beginAttempt, clearAttempts, failAttempt } from "@/lib/login-guard";
import { clientIp, lockedError } from "@/lib/login-throttle";
import { deviceSlot, sessionColumn } from "@/lib/device-slot";
import { CHALLENGE_COOKIE, TICKET_TTL_MS, clearChallenge, newSessionId, readPayload, relyingParty, signPayload, type ChallengePayload, type LoginTicket } from "@/lib/passkey";

const schema = z.object({ response: z.object({ id: z.string().max(1024) }).passthrough() });

const refuse = (status: number, error: string) => clearChallenge(NextResponse.json({ error }, { status }));
const FAILED = "Fingerprint / Face ID sign-in didn't work. Use your password.";

/**
 * POST /api/passkey/login/verify — checks the phone's fingerprint / Face ID signature. If it is genuine this returns a
 * one-minute ticket that the sign-in page swaps for a normal session (see the "passkey" provider in lib/auth.ts), so
 * passkeys end up in exactly the same session — and the same one-device rule — as passwords.
 */
export const POST = handleApi(async (req: NextRequest) => {
  const body = schema.parse(await req.json());
  const ip = clientIp(req.headers.get("x-forwarded-for"));

  // Same lockout as passwords: repeated bad answers from one place pause sign-in from that place.
  const attempt = await beginAttempt("LOGIN", `passkey:${ip}`, ip);
  if (attempt.blocked) return refuse(429, lockedError(attempt.blocked.minutes));

  const challenge = readPayload<ChallengePayload>(req.cookies.get(CHALLENGE_COOKIE)?.value);
  const passkey =
    challenge?.purpose === "login"
      ? await prisma.passkey.findUnique({ where: { credentialId: body.response.id }, include: { user: { select: { id: true, active: true, role: true } } } })
      : null;
  if (!challenge || !passkey || !passkey.user.active || passkey.user.role === "CLIENT") {
    await failAttempt(attempt);
    return refuse(401, FAILED);
  }

  const { rpID, origin } = relyingParty();
  let result;
  try {
    result = await verifyAuthenticationResponse({
      response: body.response as never,
      expectedChallenge: challenge.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: { id: passkey.credentialId, publicKey: Uint8Array.from(Buffer.from(passkey.publicKey, "base64url")), counter: passkey.counter, transports: passkey.transports as never },
      requireUserVerification: true,
    });
  } catch {
    await failAttempt(attempt);
    return refuse(401, FAILED);
  }
  if (!result.verified) {
    await failAttempt(attempt);
    return refuse(401, FAILED);
  }

  await prisma.passkey.update({ where: { id: passkey.id }, data: { counter: result.authenticationInfo.newCounter, lastUsedAt: new Date() } });
  // The fingerprint check passed: this becomes the person's one signed-in device (every other device is signed out).
  // (The Owner may also stay signed in on one phone and one computer: the phone has its own slot.)
  const sid = newSessionId();
  const slot = deviceSlot(req.headers.get("user-agent"));
  await prisma.user.update({ where: { id: passkey.userId }, data: { [sessionColumn(passkey.user.role, slot)]: sid } });
  await clearAttempts(attempt);
  const ticket = signPayload({ typ: "passkey-login", uid: passkey.userId, sid, slot, exp: Date.now() + TICKET_TTL_MS } satisfies LoginTicket);
  return clearChallenge(NextResponse.json({ ticket }));
});
