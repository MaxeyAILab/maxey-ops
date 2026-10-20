import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import { CHALLENGE_COOKIE, clearChallenge, readPayload, relyingParty, type ChallengePayload } from "@/lib/passkey";

const schema = z.object({ response: z.record(z.unknown()), label: z.string().trim().min(1).max(60).optional() });

/** POST /api/passkey/register/verify — the phone's answer; if it checks out, this phone can sign the person in. */
export const POST = handleApi(async (req: NextRequest) => {
  const user = await requireUser();
  if (user.role === "CLIENT") throw new ApiError(403, "Not authorized");
  const body = schema.parse(await req.json());
  const challenge = readPayload<ChallengePayload>(req.cookies.get(CHALLENGE_COOKIE)?.value);
  if (!challenge || challenge.purpose !== "register" || challenge.uid !== user.id) throw new ApiError(400, "That took too long — please try again");

  const { rpID, origin } = relyingParty();
  let verified;
  try {
    verified = await verifyRegistrationResponse({
      response: body.response as never,
      expectedChallenge: challenge.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
  } catch {
    throw new ApiError(400, "Couldn't verify the fingerprint / Face ID setup");
  }
  if (!verified.verified || !verified.registrationInfo) throw new ApiError(400, "Couldn't verify the fingerprint / Face ID setup");
  const { credential } = verified.registrationInfo;

  const taken = await prisma.passkey.findUnique({ where: { credentialId: credential.id }, select: { id: true } });
  if (taken) throw new ApiError(409, "This device is already set up");
  await prisma.passkey.create({
    data: {
      userId: user.id,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString("base64url"),
      counter: credential.counter,
      transports: (credential.transports ?? []) as string[],
      label: body.label ?? "Phone",
    },
  });
  await audit({ entityType: "User", entityId: user.id, actorId: user.id, actorName: user.name, action: "PASSKEY_ADDED", diff: { label: body.label ?? "Phone" } });
  return clearChallenge(NextResponse.json({ ok: true }));
});
