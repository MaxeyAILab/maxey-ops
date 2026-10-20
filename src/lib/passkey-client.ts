"use client";

import { browserSupportsWebAuthn, startAuthentication, startRegistration } from "@simplewebauthn/browser";

export const passkeysSupported = () => typeof window !== "undefined" && browserSupportsWebAuthn();

async function post<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? "Something went wrong");
  return json;
}

/** Set up fingerprint / Face ID on this phone for the signed-in person. */
export async function registerPasskey(label: string): Promise<void> {
  const optionsJSON = await post<Parameters<typeof startRegistration>[0]["optionsJSON"]>("/api/passkey/register/options");
  const response = await startRegistration({ optionsJSON });
  await post("/api/passkey/register/verify", { response, label });
}

/** Ask for a fingerprint / Face ID check and return the ticket the sign-in page redeems for a session. */
export async function passkeyTicket(): Promise<string> {
  const optionsJSON = await post<Parameters<typeof startAuthentication>[0]["optionsJSON"]>("/api/passkey/login/options");
  const response = await startAuthentication({ optionsJSON });
  const { ticket } = await post<{ ticket: string }>("/api/passkey/login/verify", { response });
  return ticket;
}

/** True when the person just closed the fingerprint / Face ID prompt, which isn't worth an error message. */
export const wasCancelled = (err: unknown) => (err as Error)?.name === "NotAllowedError" || (err as Error)?.name === "AbortError";
