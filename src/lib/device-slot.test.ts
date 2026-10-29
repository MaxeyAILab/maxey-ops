import { describe, expect, it } from "vitest";
import { deviceSlot, sessionColumn, sessionIsCurrent } from "./device-slot";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

describe("device type", () => {
  it("phones are phones, computers are computers, and unknown is a computer", () => {
    expect(deviceSlot(IPHONE)).toBe("phone");
    expect(deviceSlot(ANDROID)).toBe("phone");
    expect(deviceSlot(WINDOWS)).toBe("desktop");
    expect(deviceSlot("")).toBe("desktop");
    expect(deviceSlot(undefined)).toBe("desktop");
  });
});

describe("which slot a sign-in uses", () => {
  it("the Owner's phone has its own slot; the Owner's computer uses the usual one", () => {
    expect(sessionColumn("OWNER", "phone")).toBe("mobileSessionId");
    expect(sessionColumn("OWNER", "desktop")).toBe("currentSessionId");
  });
  it("everyone else has one slot, phone or not", () => {
    for (const role of ["PM", "FOREMAN", "ACCOUNTING", "DRIVER", "CLIENT"]) {
      expect(sessionColumn(role, "phone")).toBe("currentSessionId");
      expect(sessionColumn(role, "desktop")).toBe("currentSessionId");
    }
  });
});

describe("is a session still valid", () => {
  const owner = { role: "OWNER", currentSessionId: "desk", mobileSessionId: "phone" };
  it("the Owner's computer and phone sessions are both valid at once", () => {
    expect(sessionIsCurrent(owner, "desk")).toBe(true);
    expect(sessionIsCurrent(owner, "phone")).toBe(true);
  });
  it("an Owner session that was replaced is not valid", () => {
    expect(sessionIsCurrent(owner, "old")).toBe(false);
    expect(sessionIsCurrent({ ...owner, mobileSessionId: "phone2" }, "phone")).toBe(false);
  });
  it("another role never gets a second slot, even if one is left over from before", () => {
    const pm = { role: "PM", currentSessionId: "a", mobileSessionId: "b" };
    expect(sessionIsCurrent(pm, "a")).toBe(true);
    expect(sessionIsCurrent(pm, "b")).toBe(false);
  });
  it("a missing session id or an empty account is never valid", () => {
    expect(sessionIsCurrent(owner, undefined)).toBe(false);
    expect(sessionIsCurrent({ role: "OWNER", currentSessionId: null, mobileSessionId: null }, "x")).toBe(false);
  });
});
