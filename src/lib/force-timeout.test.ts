import { describe, expect, it } from "vitest";
import { defaultForcedTimeOut, forcedTimeOut } from "./force-timeout";

const at = (iso: string) => new Date(iso); // +08:00 Manila

describe("forcedTimeOut", () => {
  const timeIn = at("2026-11-02T08:00:00+08:00");
  const now = at("2026-11-03T09:00:00+08:00");
  it("sets the time on the day the shift started", () => {
    const r = forcedTimeOut(timeIn, "17:00", now);
    expect(r.ok && r.at.toISOString()).toBe(at("2026-11-02T17:00:00+08:00").toISOString());
  });
  it("refuses a time before the time-in, a bad time, and the future", () => {
    expect(forcedTimeOut(timeIn, "07:59", now).ok).toBe(false);
    expect(forcedTimeOut(timeIn, "8:00", now).ok).toBe(false);
    expect(forcedTimeOut(at("2026-11-03T08:00:00+08:00"), "17:00", at("2026-11-03T12:00:00+08:00")).ok).toBe(false);
  });
});

describe("defaultForcedTimeOut", () => {
  it("is 5 PM when the day is over", () => {
    expect(defaultForcedTimeOut(at("2026-11-02T08:00:00+08:00"), at("2026-11-03T09:00:00+08:00"))).toBe("17:00");
    expect(defaultForcedTimeOut(at("2026-11-03T08:00:00+08:00"), at("2026-11-03T18:30:00+08:00"))).toBe("17:00");
  });
  it("is now when it is still before 5 PM the same day", () => {
    expect(defaultForcedTimeOut(at("2026-11-03T08:00:00+08:00"), at("2026-11-03T14:25:40+08:00"))).toBe("14:25");
  });
  it("is the end of the day for a shift begun after 5 PM on an earlier day", () => {
    expect(defaultForcedTimeOut(at("2026-11-02T18:00:00+08:00"), at("2026-11-03T09:00:00+08:00"))).toBe("23:59");
  });
});
