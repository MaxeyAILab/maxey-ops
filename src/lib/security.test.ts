import { describe, expect, it } from "vitest";
import {
  MAX_FAILS_PER_EMAIL,
  MAX_FAILS_PER_EMAIL_AND_IP,
  MAX_FAILS_PER_IP,
  WINDOW_MINUTES,
  clientIp,
  lockedError,
  minutesUntilUnlocked,
  parseLockedError,
  throttleEmail,
  throttleReason,
} from "./login-throttle";
import { MIN_PASSWORD_LENGTH, validatePassword } from "./password-policy";

describe("sign-in lockout rules", () => {
  it("allows the first five wrong tries for an email from one place, and locks on the sixth", () => {
    // counts include the attempt being judged
    for (let n = 1; n <= MAX_FAILS_PER_EMAIL_AND_IP; n++) expect(throttleReason({ pair: n, email: n, ip: n })).toBeNull();
    expect(throttleReason({ pair: MAX_FAILS_PER_EMAIL_AND_IP + 1, email: 6, ip: 6 })).toBe("pair");
  });

  it("does not let one place lock the real owner out from somewhere else", () => {
    // 5 bad tries from the attacker's address are counted against that address + email only; the owner's own
    // address has a clean pair count, so the owner can still sign in
    expect(throttleReason({ pair: 1, email: 6, ip: 1 })).toBeNull();
  });

  it("locks an email that is being guessed from many places", () => {
    expect(throttleReason({ pair: 2, email: MAX_FAILS_PER_EMAIL, ip: 2 })).toBeNull();
    expect(throttleReason({ pair: 2, email: MAX_FAILS_PER_EMAIL + 1, ip: 2 })).toBe("email");
  });

  it("blocks one address that tries many accounts", () => {
    expect(throttleReason({ pair: 1, email: 1, ip: MAX_FAILS_PER_IP })).toBeNull();
    expect(throttleReason({ pair: 1, email: 1, ip: MAX_FAILS_PER_IP + 1 })).toBe("ip");
  });

  it("tells the person how long to wait, rounded up and never zero", () => {
    const now = new Date("2026-10-14T10:00:00Z");
    expect(minutesUntilUnlocked(new Date("2026-10-14T09:50:00Z"), now)).toBe(5);
    expect(minutesUntilUnlocked(new Date("2026-10-14T09:45:30Z"), now)).toBe(1); // 30s left → 1 minute
    expect(minutesUntilUnlocked(new Date("2026-10-14T09:45:00Z"), now)).toBe(1); // just expiring → never "0"
    expect(minutesUntilUnlocked(new Date("2026-10-14T10:00:00Z"), now)).toBe(WINDOW_MINUTES);
    expect(minutesUntilUnlocked(null, now)).toBe(WINDOW_MINUTES);
  });

  it("round-trips the error text the sign-in page reads", () => {
    expect(parseLockedError(lockedError(12))).toBe(12);
    expect(parseLockedError("CredentialsSignin")).toBeNull();
    expect(parseLockedError(null)).toBeNull();
    expect(parseLockedError("LOCKED:abc")).toBeNull();
  });

  it("reads the client address from the proxy header", () => {
    expect(clientIp("203.0.113.9, 10.0.0.1")).toBe("203.0.113.9");
    expect(clientIp(["198.51.100.4"])).toBe("198.51.100.4");
    expect(clientIp(undefined)).toBe("unknown");
    expect(clientIp("")).toBe("unknown");
  });

  it("records an email the same way whatever case or spacing was typed, and bounds its length", () => {
    expect(throttleEmail("  Engr.Villamor@Gmail.com ")).toBe("engr.villamor@gmail.com");
    expect(throttleEmail(undefined)).toBe("");
    expect(throttleEmail("a".repeat(500))).toHaveLength(254);
  });
});

describe("password rules", () => {
  const ctx = { email: "juan.delacruz@maxeyconstruction.ph", name: "Juan Dela Cruz" };

  it("requires the minimum length", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(10);
    expect(validatePassword("Short1!", ctx)).toMatch(/at least 10/);
    expect(validatePassword("a-long-enough-one", ctx)).toBeNull();
  });

  it("accepts a plain sentence — length matters more than symbols", () => {
    expect(validatePassword("my dog likes rainy mondays", ctx)).toBeNull();
  });

  it("refuses very common choices, however they are dressed", () => {
    for (const bad of ["password123", "Password123", "PASSWORD-123", "1234567890", "qwertyuiop", "Maxey123456", "maxey construction 1"]) {
      expect(validatePassword(bad, ctx), bad).not.toBeNull();
    }
  });

  it("refuses repeated characters and blank passwords", () => {
    expect(validatePassword("aaaaaaaaaaaa", ctx)).toMatch(/variety/);
    expect(validatePassword("            ", ctx)).not.toBeNull();
  });

  it("refuses a password built from the person's own email or name", () => {
    expect(validatePassword("juan.delacruz2026!", ctx)).toMatch(/email/);
    expect(validatePassword("juandelacruz-pa55", { name: "Juan Dela Cruz" })).toMatch(/name/);
  });

  it("refuses names only when they are long enough to be meaningful", () => {
    expect(validatePassword("ramon-and-the-bridge", { email: "r@x.ph", name: "Ramon" })).toMatch(/name/);
    expect(validatePassword("xyz-and-the-bridge-1", { email: "r@x.ph", name: "Xy" })).toBeNull();
  });

  it("refuses passwords past the maximum", () => {
    expect(validatePassword("x1".repeat(60), ctx)).toMatch(/at most/);
  });
});
