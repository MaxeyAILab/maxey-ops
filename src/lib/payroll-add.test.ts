import { describe, expect, it } from "vitest";
import { hourlyRateForUser, otMultiplierFor, pricedEntry, workingDaysInPeriod } from "./payroll";

const manila = (day: string, time = "00:00") => new Date(`${day}T${time}:00+08:00`);

describe("working days in a pay period", () => {
  it("counts Monday to Saturday, both ends included", () => {
    expect(workingDaysInPeriod(manila("2026-10-01"), manila("2026-10-15", "23:59"))).toBe(13); // Oct 1-15, 2026
    expect(workingDaysInPeriod(manila("2026-09-16"), manila("2026-09-30", "23:59"))).toBe(13); // two Sundays out of 15
    expect(workingDaysInPeriod(manila("2026-10-16"), manila("2026-10-31", "23:59"))).toBe(14);
  });

  it("uses the Manila calendar day, not the server's", () => {
    // 1 Oct 00:00 in Manila is still 30 Sept in UTC
    expect(workingDaysInPeriod(new Date("2026-09-30T16:00:00Z"), new Date("2026-10-15T15:59:00Z"))).toBe(13);
  });

  it("handles a single day and a single Sunday", () => {
    expect(workingDaysInPeriod(manila("2026-10-14"), manila("2026-10-14", "23:59"))).toBe(1);
    expect(workingDaysInPeriod(manila("2026-10-18"), manila("2026-10-18", "23:59"))).toBe(0); // a Sunday
  });
});

describe("pricing an entry (the same for a built-from-clock run and a person added by hand)", () => {
  const who = { id: "u1", name: "Test Person" };

  it("prices gross, the placeholder deductions and net to the centavo", () => {
    // 91.93 hrs x 120.37/hr = 11,065.6141 -> SSS 4.5%, PhilHealth 2.5%, Pag-IBIG 100 flat
    const e = pricedEntry(who, 12, 91.93, 0, 120.37);
    expect(e.gross).toBe(11065.61);
    expect(e.sss).toBe(497.95);
    expect(e.philhealth).toBe(276.64);
    expect(e.pagibig).toBe(100);
    expect(e.net).toBe(10191.02);
  });

  it("prices overtime at 1.25 times the rate", () => {
    const e = pricedEntry(who, 3, 24, 2, 100);
    expect(e.gross).toBe(2650); // 24 x 100 + 2 x 100 x 1.25
  });

  it("charges no Pag-IBIG and pays nothing for zero hours", () => {
    const e = pricedEntry(who, 0, 0, 0, 100);
    expect(e.gross).toBe(0);
    expect(e.pagibig).toBe(0);
    expect(e.net).toBe(0);
  });

  it("starts the manually-set deductions at zero", () => {
    const e = pricedEntry(who, 0, 104, 0, 92.59);
    expect([e.meals, e.cashAdvance]).toEqual([0, 0]);
  });
});

describe("hourly rate from a profile", () => {
  const oct = manila("2026-10-01");
  it("spreads a monthly salary over the month's Monday-Saturday days and 8-hour days", () => {
    // October 2026 has 27 Monday-Saturday days: 20,000 / 27 / 8
    expect(hourlyRateForUser({ monthlySalary: 20000, hourlyRate: null, dailyRate: null }, oct)).toBeCloseTo(92.59, 2);
  });

  it("prefers a monthly salary, then an hourly rate, then the daily rate over 8", () => {
    expect(hourlyRateForUser({ monthlySalary: 20000, hourlyRate: 200, dailyRate: 1600 }, oct)).toBeCloseTo(92.59, 2);
    expect(hourlyRateForUser({ monthlySalary: null, hourlyRate: 200, dailyRate: 1600 }, oct)).toBe(200);
    expect(hourlyRateForUser({ monthlySalary: null, hourlyRate: null, dailyRate: 1600 }, oct)).toBe(200);
  });

  it("is zero when no rate is set", () => {
    expect(hourlyRateForUser({ monthlySalary: null, hourlyRate: null, dailyRate: null }, oct)).toBe(0);
  });
});

describe("overtime rate by department", () => {
  const who = { id: "u1", name: "Test Person" };

  it("pays drivers' overtime at the normal hourly rate and everyone else's at 1.25x", () => {
    expect(otMultiplierFor("DRIVER")).toBe(1);
    for (const dept of ["OFFICE", "ARCHITECT", "ENGINEER", "SITE", null, undefined]) expect(otMultiplierFor(dept)).toBe(1.25);
  });

  it("prices a driver's 48 regular + 4 overtime hours at 52 x the rate (the register's real case)", () => {
    const driver = pricedEntry(who, 6, 48, 4, 91.25, otMultiplierFor("DRIVER"));
    expect(driver.gross).toBe(4745); // 52 x 91.25
    const office = pricedEntry(who, 6, 48, 4, 91.25, otMultiplierFor("OFFICE"));
    expect(office.gross).toBe(4836.25); // 48 x 91.25 + 4 x 91.25 x 1.25
  });

  it("changes nothing for a person with no overtime", () => {
    expect(pricedEntry(who, 6, 36, 0, 93.75, 1).gross).toBe(3375);
    expect(pricedEntry(who, 6, 36, 0, 93.75, 1.25).gross).toBe(3375);
  });
});
