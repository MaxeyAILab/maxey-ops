/**
 * Password rules for any password a person chooses. Length does most of the work, so there is
 * no "must contain a symbol" rule — instead the obvious choices are refused.
 * Temporary passwords the system generates are not run through this; they force a change on first sign-in,
 * and the new password is checked here.
 */
export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 100;

const COMMON = new Set([
  "password",
  "password1",
  "password12",
  "password123",
  "password1234",
  "passw0rd123",
  "qwertyuiop",
  "qwerty1234",
  "qwerty12345",
  "1234567890",
  "12345678910",
  "123456789012",
  "0123456789",
  "abcdefghij",
  "abcd123456",
  "iloveyou123",
  "welcome123",
  "welcome1234",
  "admin12345",
  "administrator",
  "letmein1234",
  "maxey12345",
  "maxey123456",
  "maxeyconstruction",
  "maxeyconstruction1",
  "maxeyconstruction123",
  "construction123",
  "construction1",
  "changeme123",
  "changeme1234",
]);

const stripped = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Returns a plain-language reason the password is refused, or null when it is acceptable. */
export function validatePassword(password: string, context: { email?: string | null; name?: string | null } = {}): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters`;
  if (password.length > MAX_PASSWORD_LENGTH) return `Use at most ${MAX_PASSWORD_LENGTH} characters`;
  if (/^\s+$/.test(password)) return "A password can't be just spaces";
  if (new Set(password).size < 4) return "Use a password with more variety than repeated characters";
  const flat = stripped(password);
  if (COMMON.has(flat)) return "That password is too common — choose something harder to guess";
  if (/^(?:0123456789|1234567890|abcdefghij|qwertyuiop)/.test(flat) && flat.length <= 14) return "That is an easy-to-guess pattern — choose something harder to guess";
  const local = stripped((context.email ?? "").split("@")[0] ?? "");
  if (local.length >= 4 && flat.includes(local)) return "Don't include your email name in your password";
  const name = stripped(context.name ?? "");
  if (name.length >= 5 && flat.includes(name)) return "Don't include your name in your password";
  return null;
}
