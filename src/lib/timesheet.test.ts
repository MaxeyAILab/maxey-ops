import { describe, expect, it } from "vitest";
import { computeEffectiveHours, manilaTime } from "./time-rules";
import { FULL_DAY, canEditSheet, canOpenTimesheets, isNoLoginAccount, isTimekeeperPosition, regularHours, sheetShifts, validateSheetRow, type SheetInput } from "./timesheet";

const row = (over: Partial<SheetInput> = {}): SheetInput => ({ ...FULL_DAY, otHours: null, approvedBy: null, remarks: null, absent: false, ...over });
const DAY = "2026-11-03";

describe("what the sheet will accept", () => {
  it("accepts a full day, a half day, a late arrival and an empty (not yet recorded) row", () => {
    expect(validateSheetRow(row())).toBeNull();
    expect(validateSheetRow(row({ pmIn: null, pmOut: null }))).toBeNull();
    expect(validateSheetRow(row({ amIn: "08:15" }))).toBeNull();
    expect(validateSheetRow(row({ amIn: null, amOut: null, pmIn: null, pmOut: null }))).toBeNull();
  });
  it("keeps the AM times inside 7:30–12:00 and the PM times inside 1:00–5:00", () => {
    expect(validateSheetRow(row({ amIn: "07:00" }))).toMatch(/AM.*before 07:30/);
    expect(validateSheetRow(row({ amOut: "12:30" }))).toMatch(/AM.*after 12:00/);
    expect(validateSheetRow(row({ pmIn: "12:30" }))).toMatch(/PM.*before 13:00/);
    expect(validateSheetRow(row({ pmOut: "17:30" }))).toMatch(/PM.*after 17:00/);
  });
  it("needs both times of a half, and the out after the in", () => {
    expect(validateSheetRow(row({ amOut: null }))).toMatch(/both/);
    expect(validateSheetRow(row({ pmIn: "16:00", pmOut: "15:00" }))).toMatch(/after the time in/);
    expect(validateSheetRow(row({ amIn: "7:30" }))).toMatch(/like 07:30/);
  });
  it("a worker marked absent has no times or overtime", () => {
    expect(validateSheetRow(row({ absent: true, amIn: null, amOut: null, pmIn: null, pmOut: null }))).toBeNull();
    expect(validateSheetRow(row({ absent: true }))).toMatch(/absent/);
  });
  it("overtime is after 5:00 PM, in quarter hours, up to 6 hours, and needs the engineer's or foreman's approval", () => {
    expect(validateSheetRow(row({ otHours: 2, approvedBy: "Engr. Reyes" }))).toBeNull();
    expect(validateSheetRow(row({ otHours: 2 }))).toMatch(/approved by the site\/project engineer or the foreman/);
    expect(validateSheetRow(row({ otHours: 2, approvedBy: "Engr. Reyes", pmOut: "16:00" }))).toMatch(/PM time out must be 17:00/);
    expect(validateSheetRow(row({ otHours: 1.1, approvedBy: "Engr. Reyes" }))).toMatch(/quarter/);
    expect(validateSheetRow(row({ otHours: 7, approvedBy: "Engr. Reyes" }))).toMatch(/more than 6/);
    expect(validateSheetRow(row({ otHours: -1 }))).toMatch(/negative/);
  });
});

describe("what the sheet becomes in payroll", () => {
  const at = (hm: string) => { const [h, m] = hm.split(":").map(Number); return manilaTime(DAY, h, m); };
  it("a full day is 8 paid hours — the same as one punch from 7:30 to 5:00 (lunch and the two breaks taken off)", () => {
    expect(regularHours(DAY, row())).toBe(8);
    expect(computeEffectiveHours(at("07:30"), at("17:00"), "SITE")).toBeCloseTo(8, 6);
  });
  it("a half day and a late arrival are paid for what was worked", () => {
    expect(regularHours(DAY, row({ pmIn: null, pmOut: null }))).toBe(4.25); // 4.5 h minus the 10:00 break
    expect(regularHours(DAY, row({ amIn: "08:30" }))).toBe(7); // an hour less
  });
  it("overtime is not paid until it is approved: the day stays at 8 hours", () => {
    expect(regularHours(DAY, row({ otHours: 2, approvedBy: "Foreman" }))).toBe(8);
  });
  it("the PM shift ends at 5:00 PM plus the overtime worked, so the overtime request has the real clock-out to show", () => {
    const { pm } = sheetShifts(DAY, row({ otHours: 2.5, approvedBy: "Foreman" }));
    expect(pm?.out.getTime()).toBe(at("17:00").getTime() + 2.5 * 3_600_000);
  });
  it("an absent worker and an empty row have no shifts", () => {
    expect(sheetShifts(DAY, row({ absent: true, amIn: null, amOut: null, pmIn: null, pmOut: null }))).toEqual({ am: null, pm: null });
    expect(regularHours(DAY, row({ amIn: null, amOut: null, pmIn: null, pmOut: null }))).toBe(0);
  });
});

describe("who may edit the sheet", () => {
  const timekeeper = { role: "DRIVER", position: "Timekeeper/Electrician" };
  const ctx = (o: Partial<{ assignedToProject: boolean; dayKey: string }> = {}) => ({ assignedToProject: true, dayKey: "2026-11-03", todayKey: "2026-11-03", ...o });
  it("recognises a timekeeper by position, however it is spelled", () => {
    for (const p of ["Timekeeper", "Time Keeper", "time-keeper", "Timekeeper/Electrician"]) expect(isTimekeeperPosition(p), p).toBe(true);
    for (const p of ["Foreman", "Leadman", "Mason", null, ""]) expect(isTimekeeperPosition(p), String(p)).toBe(false);
  });
  it("only the timekeeper, the PM and the Owner can open it", () => {
    expect(canOpenTimesheets({ role: "OWNER" })).toBe(true);
    expect(canOpenTimesheets({ role: "PM" })).toBe(true);
    expect(canOpenTimesheets(timekeeper)).toBe(true);
    for (const u of [{ role: "FOREMAN", position: "General Foreman" }, { role: "PURCHASING" }, { role: "ACCOUNTING" }, { role: "OFFICE", position: "Mason" }, { role: "CLIENT", position: "Timekeeper" }]) expect(canOpenTimesheets(u), JSON.stringify(u)).toBe(false);
  });
  it("a timekeeper edits only a project they are assigned to", () => {
    expect(canEditSheet(timekeeper, ctx()).ok).toBe(true);
    expect(canEditSheet(timekeeper, ctx({ assignedToProject: false })).ok).toBe(false);
    expect(canEditSheet({ role: "PM" }, ctx({ assignedToProject: false })).ok).toBe(true);
    expect(canEditSheet({ role: "OWNER" }, ctx({ assignedToProject: false })).ok).toBe(true);
  });
  it("nobody records a future day; a timekeeper can go back two weeks, the Owner and PM further", () => {
    expect(canEditSheet({ role: "OWNER" }, ctx({ dayKey: "2026-11-04" })).ok).toBe(false);
    expect(canEditSheet(timekeeper, ctx({ dayKey: "2026-10-20" })).ok).toBe(true);
    expect(canEditSheet(timekeeper, ctx({ dayKey: "2026-10-19" })).ok).toBe(false);
    expect(canEditSheet({ role: "PM" }, ctx({ dayKey: "2026-08-01" })).ok).toBe(true);
  });
  it("the workers on the sheet are those with no login of their own", () => {
    expect(isNoLoginAccount("juan.dela.cruz.1a2b3c@staff.maxeyconstruction.ph")).toBe(true);
    expect(isNoLoginAccount("juan@gmail.com")).toBe(false);
    expect(isNoLoginAccount(null)).toBe(false);
  });
});
