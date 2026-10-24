import { describe, expect, it } from "vitest";
import { claimedExtraHours, computeEffectiveHours, manilaTime } from "./time-rules";

// 19 Oct 2026 is a Monday (Manila time)
const DAY = "2026-10-19";
const at = (h: number, m = 0) => manilaTime(DAY, h, m);

describe("computeEffectiveHours — unchanged rules", () => {
  it("a normal office day: 8:00–5:00 less one hour of lunch = 8 hours", () => {
    expect(computeEffectiveHours(at(8), at(17), "OFFICE")).toBe(8);
  });

  it("without an approval the day ends at 5:00 PM and an early arrival counts from the scheduled start", () => {
    expect(computeEffectiveHours(at(7), at(20), "OFFICE")).toBe(8);
    expect(computeEffectiveHours(at(7), at(20), "SITE")).toBeCloseTo(8, 5); // 7:30–5:00 = 9.5h − lunch 1h − two 15-min breaks
  });
});

describe("an approved overtime", () => {
  const flags = { earlyStartApproved: false, overtimeApproved: true, weekendApproved: false };

  it("with no number set counts all the clocked time (how approvals worked before)", () => {
    // 8:00 AM → 8:04 PM = 12h04 − 1h lunch
    expect(computeEffectiveHours(at(8), at(20, 4), "OFFICE", flags)).toBeCloseTo(11.07, 2);
  });

  it("with a number set counts only that many hours after 5:00 PM", () => {
    expect(computeEffectiveHours(at(8), at(20, 4), "OFFICE", { ...flags, overtimeHours: 1.5 })).toBe(9.5); // 8 regular + 1.5
    expect(computeEffectiveHours(at(8), at(20, 4), "OFFICE", { ...flags, overtimeHours: 1 })).toBe(9);
  });

  it("the Owner can credit more than the clock shows: exactly the number he set counts", () => {
    // clocked out 5:05 PM (0.08 h after 5:00); credited 2 h → 8 regular + 2
    expect(computeEffectiveHours(at(8), at(17, 5), "OFFICE", { ...flags, overtimeHours: 2 })).toBe(10);
    expect(computeEffectiveHours(at(8), at(18, 30), "OFFICE", { ...flags, overtimeHours: 5 })).toBe(13);
  });

  it("a shift that ends before 5:00 PM is not affected", () => {
    expect(computeEffectiveHours(at(8), at(16), "OFFICE", { ...flags, overtimeHours: 1 })).toBe(7);
  });
});

describe("an approved early start", () => {
  const flags = { earlyStartApproved: true, overtimeApproved: false, weekendApproved: false };

  it("with a number set counts only that many hours before the scheduled start", () => {
    // site: scheduled 7:30; came at 5:00 (2.5h early), 5:00–5:00 PM → full span less lunch and breaks
    const all = computeEffectiveHours(at(5), at(17), "SITE", flags);
    const some = computeEffectiveHours(at(5), at(17), "SITE", { ...flags, earlyStartHours: 1 });
    expect(all - some).toBeCloseTo(1.5, 5); // 2.5 claimed, 1 credited
    expect(computeEffectiveHours(at(5), at(17), "SITE", { ...flags, earlyStartHours: 2.5 })).toBeCloseTo(all, 5);
    // more than was clocked early: counts exactly what was credited
    expect(computeEffectiveHours(at(7), at(12, 30), "SITE", { ...flags, earlyStartHours: 2 })).toBeCloseTo(computeEffectiveHours(at(7, 30), at(12, 30), "SITE") + 2, 5);
  });
});

describe("claimedExtraHours", () => {
  it("overtime = clock-out time after 5:00 PM", () => {
    expect(claimedExtraHours("OVERTIME", at(8), at(20, 4), "OFFICE")).toBe(3.07);
    expect(claimedExtraHours("OVERTIME", at(8), at(17), "OFFICE")).toBe(0);
    expect(claimedExtraHours("OVERTIME", at(8), null, "OFFICE")).toBe(0);
  });

  it("early start = clock-in time before the scheduled start (7:30 site, 8:00 office)", () => {
    expect(claimedExtraHours("EARLY_START", at(5), at(17), "SITE")).toBe(2.5);
    expect(claimedExtraHours("EARLY_START", at(7), at(17), "OFFICE")).toBe(1);
    expect(claimedExtraHours("EARLY_START", at(9), at(17), "OFFICE")).toBe(0);
  });
});
