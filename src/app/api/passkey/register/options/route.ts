import { NextResponse } from "next/server";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { prisma } from "@/lib/prisma";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import { RP_NAME, relyingParty, withChallenge } from "@/lib/passkey";

const MAX_PER_PERSON = 6;

/** POST /api/passkey/register/options — start setting up fingerprint / Face ID on this phone (signed-in staff only). */
export const POST = handleApi(async () => {
  const user = await requireUser();
  if (user.role === "CLIENT") throw new ApiError(403, "Not authorized");
  const existing = await prisma.passkey.findMany({ where: { userId: user.id }, select: { credentialId: true, transports: true } });
  if (existing.length >= MAX_PER_PERSON) throw new ApiError(400, "You already have the most devices set up — remove one first");
  const { rpID } = relyingParty();
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userName: user.email,
    userDisplayName: user.name,
    userID: new TextEncoder().encode(user.id),
    attestationType: "none",
    excludeCredentials: existing.map((p) => ({ id: p.credentialId, transports: p.transports as never })),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
  return withChallenge(NextResponse.json(options), { purpose: "register", challenge: options.challenge, uid: user.id });
});
