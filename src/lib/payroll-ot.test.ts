import { describe, expect, it } from "vitest";
import type { Attendance } from "@prisma/client";
import { computeDailyHoursByDay, creditedOvertimeByDay, refreshEntryHours, splitRegularAndOvertime } from "./payroll";
import type { AdjustmentFlags } from "./time-rules";

const at = (iso: string) => new Date(iso);
const shift = (id: string, userId: string, timeIn: string, timeOut: string) => ({ id, userId, timeIn: at(timeIn), timeOut: at(timeOut) }) as unknown as Attendance;
const flags = (over: Partial<AdjustmentFlags>): AdjustmentFlags => ({ earlyStartApproved: false, overtimeApproved: false, weekendApproved: false, ...over });

/** the regular/overtime hours payroll pays for these shifts (site schedule: 7:30 start) */
function pay(records: Attendance[], approvals: Map<string, AdjustmentFlags>) {
  const byDay = computeDailyHoursByDay("u", records, "SITE", approvals, new Map());
  const credited = creditedOvertimeByDay(records, "SITE", approvals);
  let regular = 0;
  let ot = 0;
  for (const [day, h] of byDay) {
    const s = splitRegularAndOvertime(h, credited.get(day) ?? 0);
    regular += s.regular;
    ot += s.ot;
  }
  return { regular: Math.round(regular * 100) / 100, ot: Math.round(ot * 100) / 100 };
}

describe("splitRegularAndOvertime", () => {
  it("without a credited number, everything above 8 hours is overtime", () => {
    expect(splitRegularAndOvertime(10.37, 0)).toEqual({ regular: 8, ot: expect.closeTo(2.37, 5) });
    expect(splitRegularAndOvertime(6, 0)).toEqual({ regular: 6, ot: 0 });
  });

  it("with a credited number, exactly that many hours are overtime", () => {
    const s = splitRegularAndOvertime(10.37, 2.5);
    expect(s.ot).toBeCloseTo(2.5, 5);
    expect(s.regular).toBeCloseTo(7.87, 5);
  });

  it("never more regular than 8, and never negative", () => {
    expect(splitRegularAndOvertime(12, 1).regular).toBe(8);
    expect(splitRegularAndOvertime(1.5, 3)).toEqual({ regular: 0, ot: 1.5 });
  });
});

describe("what payroll pays Jomer and Zoilo (the Oct 16–23 case)", () => {
  it("Zoilo: clocked in 7:38, out 8:04 PM, 2.5 overtime hours credited → 2.5 overtime", () => {
    const rec = [shift("z1", "u", "2026-10-19T07:38:00+08:00", "2026-10-19T20:04:00+08:00")];
    const approvals = new Map([["z1", flags({ overtimeApproved: true, overtimeHours: 2.5 })]]);
    expect(pay(rec, approvals).ot).toBe(2.5);
  });

  it("an overtime credit bigger than the clock shows is paid in full (5 credited, out at 7:55 PM)", () => {
    const rec = [shift("j1", "u", "2026-10-19T05:36:00+08:00", "2026-10-19T19:55:00+08:00")];
    const approvals = new Map([["j1", flags({ overtimeApproved: true, overtimeHours: 5 })]]);
    expect(pay(rec, approvals)).toEqual({ regular: 8, ot: 5 });
  });

  it("an early start credit is overtime too, and the 8-hour cap no longer swallows it (3 credited)", () => {
    const rec = [shift("j2", "u", "2026-10-17T03:43:00+08:00", "2026-10-17T16:53:00+08:00")];
    const approvals = new Map([["j2", flags({ earlyStartApproved: true, earlyStartHours: 3 })]]);
    expect(pay(rec, approvals).ot).toBe(3);
  });

  it("Jomer's whole week: 5 + 3 + 2 = 10 overtime hours", () => {
    const rec = [
      shift("j2", "u", "2026-10-17T03:43:00+08:00", "2026-10-17T16:53:00+08:00"),
      shift("j1", "u", "2026-10-19T05:36:00+08:00", "2026-10-19T19:55:00+08:00"),
      shift("j3", "u", "2026-10-23T06:00:00+08:00", "2026-10-23T17:05:00+08:00"),
    ];
    const approvals = new Map([
      ["j2", flags({ earlyStartApproved: true, earlyStartHours: 3 })],
      ["j1", flags({ overtimeApproved: true, overtimeHours: 5 })],
      ["j3", flags({ overtimeApproved: true, overtimeHours: 2 })],
    ]);
    expect(pay(rec, approvals).ot).toBe(10);
  });

  it("a day with no credit keeps the old rule (capped at 8 hours, no overtime)", () => {
    const rec = [shift("n1", "u", "2026-10-20T05:00:00+08:00", "2026-10-20T20:00:00+08:00")];
    expect(pay(rec, new Map([["n1", flags({})]]))).toEqual({ regular: 8, ot: 0 });
  });

  it("an approval with no number (all the clocked time) keeps the old split: above 8 hours is overtime", () => {
    const rec = [shift("o1", "u", "2026-10-20T08:00:00+08:00", "2026-10-20T19:00:00+08:00")];
    const r = pay(rec, new Map([["o1", flags({ overtimeApproved: true })]]));
    expect(r.regular).toBe(8);
    expect(r.ot).toBeCloseTo(1.5, 5); // 7:30→7 PM = 11.0 clocked 8:00→19:00 less lunch and breaks: 11 − 1 − 0.5 − 8
  });
});

describe("refreshEntryHours — re-reading hours on a draft run", () => {
  const base = {
    userId: "u",
    name: "Jomer Manuel",
    daysWorked: 5,
    regularHours: 34.94,
    otHours: 7,
    hourlyRate: 93.75,
    gross: 3932.2,
    sss: 176.95,
    philhealth: 98.3,
    pagibig: 100,
    meals: 0,
    cashAdvance: 0,
    net: 3556.94,
  };
  const fresh = { ...base, regularHours: 34.83, otHours: 10, gross: 4202.81 };

  it("takes the new hours and days, prices them at the rate on the run, and keeps meals / cash advance", () => {
    const e = refreshEntryHours({ ...base, meals: 50, cashAdvance: 200 }, fresh, 1);
    expect(e.regularHours).toBe(34.83);
    expect(e.otHours).toBe(10);
    expect(e.gross).toBe(4202.81); // 34.83 × 93.75 + 10 × 93.75 × 1
    expect(e.meals).toBe(50);
    expect(e.cashAdvance).toBe(200);
    expect(e.hourlyRate).toBe(93.75);
    expect(e.net).toBeCloseTo(4202.81 - 189.13 - 105.07 - 100 - 50 - 200, 1);
  });

  it("SSS and PhilHealth follow the new gross when they were the standard share of the old one", () => {
    const e = refreshEntryHours(base, fresh, 1);
    expect(e.sss).toBeCloseTo(4202.81 * 0.045, 1);
    expect(e.philhealth).toBeCloseTo(4202.81 * 0.025, 1);
  });

  it("a deduction someone typed in is kept", () => {
    const e = refreshEntryHours({ ...base, sss: 250 }, fresh, 1);
    expect(e.sss).toBe(250);
    expect(e.philhealth).toBeCloseTo(4202.81 * 0.025, 1);
  });

  it("keeps the rate on the run even when the profile rate has changed", () => {
    const e = refreshEntryHours(base, { ...fresh, hourlyRate: 120 }, 1);
    expect(e.hourlyRate).toBe(93.75);
  });

  it("leaves someone added by hand, or with no attendance to read, exactly as they are", () => {
    expect(refreshEntryHours({ ...base, manual: true }, fresh, 1)).toEqual({ ...base, manual: true });
    expect(refreshEntryHours(base, undefined, 1)).toBe(base);
  });

  it("keeps the payslip reference, and never charges a job more hours than were worked", () => {
    const e = refreshEntryHours({ ...base, slipRef: "2026-009", nonCorporate: { jobId: "j", jobName: "House", hours: 60 } }, { ...fresh, regularHours: 20, otHours: 5 }, 1);
    expect(e.slipRef).toBe("2026-009");
    expect(e.nonCorporate?.hours).toBe(25);
  });
});
