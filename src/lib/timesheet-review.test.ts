import { describe, expect, it } from "vitest";
import { computeEffectiveHours, manilaTime } from "./time-rules";
import { canApproveSheet, canEditSheet, canReviewSheet, changesRecord, isForeman, isProjectEngineer, lineStage, nextStage, regularHours, sheetProgress, worksSheetFreely, type SheetInput } from "./timesheet";

const DAY = "2026-11-09";
const at = (hm: string) => { const [h, m] = hm.split(":").map(Number); return manilaTime(DAY, h, m); };
const row = (over: Partial<SheetInput> = {}): SheetInput => ({ amIn: "07:30", amOut: "12:00", pmIn: "13:00", pmOut: "17:00", otHours: null, approvedBy: null, remarks: null, absent: false, ...over });

describe("a half day is exactly 4 hours", () => {
  it("the whole morning is 4.00 and the whole afternoon is 4.00, a whole day 8.00", () => {
    expect(computeEffectiveHours(at("07:30"), at("12:00"), "SITE", undefined, true)).toBe(4);
    expect(computeEffectiveHours(at("13:00"), at("17:00"), "SITE", undefined, true)).toBe(4);
    expect(regularHours(DAY, row({ pmIn: null, pmOut: null }))).toBe(4);
    expect(regularHours(DAY, row({ amIn: null, amOut: null }))).toBe(4);
    expect(regularHours(DAY, row())).toBe(8);
  });
  it("a worker who is late or leaves early is paid for the time worked (the same as one punch for the day)", () => {
    expect(regularHours(DAY, row({ amIn: "08:30" }))).toBe(7);
    expect(regularHours(DAY, row({ pmOut: "16:00" }))).toBe(7);
    expect(computeEffectiveHours(at("08:30"), at("17:00"), "SITE")).toBeCloseTo(7, 6);
  });
  it("a worker's own clock-in/out for the day is unchanged (breaks still come off as before)", () => {
    expect(computeEffectiveHours(at("07:30"), at("12:00"), "SITE")).toBe(4.25);
    expect(computeEffectiveHours(at("13:00"), at("17:00"), "SITE")).toBe(3.75);
    expect(computeEffectiveHours(at("07:30"), at("17:00"), "SITE")).toBeCloseTo(8, 6);
  });
});

describe("who is who on the sheet", () => {
  const jonnel = { role: "OFFICE", position: "Project Engineer" };
  const mark = { role: "FOREMAN", position: "General Foreman", jobRole: "GENERAL_FOREMAN" };
  const benito = { role: "FOREMAN", position: "Foreman - Welding / Leadman" };
  it("recognises the foreman and the project engineer", () => {
    expect(isForeman(mark)).toBe(true);
    expect(isForeman(benito)).toBe(true);
    expect(isForeman({ role: "OFFICE", position: "Leadman", jobRole: "LEADMAN" })).toBe(false);
    expect(isProjectEngineer(jonnel)).toBe(true);
    expect(isProjectEngineer({ role: "OFFICE", position: "Site Engineer" })).toBe(true);
    expect(isProjectEngineer(mark)).toBe(false);
    expect(isProjectEngineer({ role: "OFFICE", position: "Mason" })).toBe(false);
    expect(isForeman({ role: "CLIENT", position: "Foreman" })).toBe(false);
  });
  it("the foreman reviews, the engineer approves, only on their own project; the Owner and PM may do either", () => {
    const on = { assignedToProject: true };
    const off = { assignedToProject: false };
    expect(canReviewSheet(mark, on)).toBe(true);
    expect(canReviewSheet(mark, off)).toBe(false);
    expect(canApproveSheet(mark, on)).toBe(false);
    expect(canApproveSheet(jonnel, on)).toBe(true);
    expect(canApproveSheet(jonnel, off)).toBe(false);
    expect(canReviewSheet(jonnel, on)).toBe(false);
    for (const u of [{ role: "OWNER" }, { role: "PM" }]) {
      expect(canReviewSheet(u, off)).toBe(true);
      expect(canApproveSheet(u, off)).toBe(true);
    }
    expect(canReviewSheet({ role: "OFFICE", position: "Admin Asst.", payrollAssist: true }, on)).toBe(false);
    expect(canApproveSheet({ role: "PURCHASING", payrollAssist: true }, on)).toBe(false);
  });
  it("the foreman and the engineer do not edit the times — only the timekeeper, PM, Owner and the staff sharing the work do", () => {
    const ctx = { assignedToProject: true, dayKey: DAY, todayKey: DAY };
    expect(canEditSheet(mark, ctx).ok).toBe(false);
    expect(canEditSheet(jonnel, ctx).ok).toBe(false);
    const helper = { role: "OFFICE", position: "Admin Asst.", payrollAssist: true };
    expect(canEditSheet(helper, { ...ctx, assignedToProject: false }).ok).toBe(true);
    expect(canEditSheet(helper, { ...ctx, dayKey: "2026-10-01" }).ok).toBe(true); // any past day, like the PM
    expect(worksSheetFreely(helper)).toBe(true);
    expect(worksSheetFreely({ role: "OFFICE", position: "Timekeeper" })).toBe(false);
    expect(worksSheetFreely({ role: "CLIENT", payrollAssist: true })).toBe(false);
  });
});

describe("the review chain", () => {
  const T = new Date();
  it("a line moves recorded → reviewed → approved, in that order only", () => {
    expect(lineStage({ reviewedAt: null, engineerApprovedAt: null })).toBe("recorded");
    expect(lineStage({ reviewedAt: T, engineerApprovedAt: null })).toBe("reviewed");
    expect(lineStage({ reviewedAt: T, engineerApprovedAt: T })).toBe("approved");
    expect(nextStage("review", true, "recorded")).toEqual({ to: "reviewed" });
    expect(nextStage("approve", true, "reviewed")).toEqual({ to: "approved" });
    expect("error" in nextStage("approve", true, "recorded")).toBe(true); // the engineer cannot approve before the foreman reviewed
    expect("error" in nextStage("review", true, "reviewed")).toBe(true);
    expect("error" in nextStage("review", true, "approved")).toBe(true);
  });
  it("taking a tick back: the approval first, then the review", () => {
    expect("error" in nextStage("review", false, "approved")).toBe(true);
    expect(nextStage("approve", false, "approved")).toEqual({ to: "reviewed" });
    expect(nextStage("review", false, "reviewed")).toEqual({ to: "recorded" });
    expect("error" in nextStage("approve", false, "reviewed")).toBe(true);
  });
  it("the banner counts lines reviewed and approved", () => {
    expect(sheetProgress([])).toMatchObject({ recorded: 0, allReviewed: false, allApproved: false });
    const p = sheetProgress([{ userId: "a", stage: "approved" }, { userId: "b", stage: "reviewed" }, { userId: "c", stage: "recorded" }]);
    expect(p).toEqual({ recorded: 3, reviewed: 2, approved: 1, allReviewed: false, allApproved: false });
    expect(sheetProgress([{ userId: "a", stage: "approved" }, { userId: "b", stage: "approved" }]).allApproved).toBe(true);
  });
  it("only a real change to times, overtime or absence clears the ticks — a remark does not", () => {
    const saved = { amIn: "07:30", amOut: "12:00", pmIn: "13:00", pmOut: "17:00", otHours: null, absent: false };
    expect(changesRecord(saved, row())).toBe(false);
    expect(changesRecord(saved, row({ remarks: "gate pass" }))).toBe(false);
    expect(changesRecord(saved, row({ amIn: "08:00" }))).toBe(true);
    expect(changesRecord(saved, row({ otHours: 1, approvedBy: "x" }))).toBe(true);
    expect(changesRecord(saved, row({ absent: true, amIn: null, amOut: null, pmIn: null, pmOut: null }))).toBe(true);
    expect(changesRecord({ ...saved, amIn: "", amOut: "" }, row({ amIn: null, amOut: null }))).toBe(false);
  });
});
