import { NextResponse } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { handleApi } from "@/lib/rbac";
import { relyingParty, withChallenge } from "@/lib/passkey";

/** POST /api/passkey/login/options — start a fingerprint / Face ID sign-in. The phone offers the passkeys it holds for this site. */
export const POST = handleApi(async () => {
  const { rpID } = relyingParty();
  const options = await generateAuthenticationOptions({ rpID, userVerification: "required", allowCredentials: [] });
  return withChallenge(NextResponse.json(options), { purpose: "login", challenge: options.challenge });
});
