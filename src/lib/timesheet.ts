import { NO_ADJUSTMENTS, computeEffectiveHours, manilaTime } from "@/lib/time-rules";

/**
 * The timekeeper's daily sheet for workers who have no login: one line per worker per day with the morning (AM) and afternoon (PM)
 * times, overtime, and who approved it on site. The times on the sheet become the worker's clock-in/clock-out records, so payroll
 * counts them with exactly the same rules as anyone else's hours. Pure rules — shared by the API, the page and the tests.
 *
 * Schedule: AM 7:30 AM – 12:00 noon, PM 1:00 PM – 5:00 PM (lunch 12:00 – 1:00 is not paid). Overtime is the hours worked AFTER
 * 5:00 PM; it is recorded here but only counted in pay once the Owner or PM approves it (the same overtime approval as ever).
 */

export const AM_FROM = "07:30";
export const AM_TO = "12:00";
export const PM_FROM = "13:00";
export const PM_TO = "17:00";
export const MAX_OVERTIME_HOURS = 6;

/** A worker present the whole scheduled day. */
export const FULL_DAY = { amIn: AM_FROM, amOut: AM_TO, pmIn: PM_FROM, pmOut: PM_TO };

export interface SheetInput {
  amIn: string | null;
  amOut: string | null;
  pmIn: string | null;
  pmOut: string | null;
  /** hours worked after 5:00 PM (0 or empty = none) */
  otHours: number | null;
  /** the site/project engineer or foreman who approved the day / the overtime */
  approvedBy: string | null;
  remarks: string | null;
  /** marked absent: no times at all */
  absent: boolean;
}

const HM = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const isHM = (v: string | null | undefined): v is string => !!v && HM.test(v);
export function toMinutes(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
}
const blank = (v: string | null | undefined) => v === null || v === undefined || v === "";

/** A reason the row cannot be saved, or null when it is fine. */
export function validateSheetRow(i: SheetInput): string | null {
  const times = [i.amIn, i.amOut, i.pmIn, i.pmOut];
  for (const t of times) if (!blank(t) && !isHM(t)) return "A time must be written like 07:30";
  const ot = i.otHours ?? 0;
  if (!Number.isFinite(ot) || ot < 0) return "Overtime cannot be negative";

  if (i.absent) {
    if (times.some((t) => !blank(t)) || ot > 0) return "A worker marked absent has no times or overtime";
    return null;
  }

  // each half of the day needs both its times or neither
  for (const [label, from, to, lo, hi] of [
    ["AM", i.amIn, i.amOut, AM_FROM, AM_TO],
    ["PM", i.pmIn, i.pmOut, PM_FROM, PM_TO],
  ] as const) {
    if (blank(from) !== blank(to)) return `${label}: enter both the time in and the time out`;
    if (blank(from) || blank(to)) continue;
    const a = toMinutes(from!);
    const b = toMinutes(to!);
    if (a < toMinutes(lo)) return `${label}: the time in cannot be before ${lo}`;
    if (b > toMinutes(hi)) return `${label}: the time out cannot be after ${hi}`;
    if (b <= a) return `${label}: the time out must be after the time in`;
  }

  if (ot > 0) {
    if (ot > MAX_OVERTIME_HOURS) return `Overtime cannot be more than ${MAX_OVERTIME_HOURS} hours a day`;
    if (Math.abs(ot * 4 - Math.round(ot * 4)) > 1e-9) return "Overtime is counted in quarter hours (0.25)";
    if (blank(i.pmIn) || i.pmOut !== PM_TO) return `Overtime is the time after ${PM_TO} — the PM time out must be ${PM_TO}`;
    if (blank(i.approvedBy) || i.approvedBy!.trim().length < 2) return "Overtime must be approved by the site/project engineer or the foreman — choose who";
  }
  return null;
}

/** The clock-in/out records a row stands for, as real instants (Manila time). The PM time out includes the overtime worked. */
export function sheetShifts(dayKey: string, i: SheetInput): { am: { in: Date; out: Date } | null; pm: { in: Date; out: Date } | null } {
  const at = (hm: string) => {
    const [h, m] = hm.split(":").map(Number);
    return manilaTime(dayKey, h, m);
  };
  const ot = Math.max(0, i.otHours ?? 0);
  return {
    am: !i.absent && isHM(i.amIn) && isHM(i.amOut) ? { in: at(i.amIn), out: at(i.amOut) } : null,
    pm: !i.absent && isHM(i.pmIn) && isHM(i.pmOut) ? { in: at(i.pmIn), out: new Date(at(i.pmOut).getTime() + ot * 3_600_000) } : null,
  };
}

/**
 * The paid hours for the day before any overtime is approved: the lunch and break rules payroll applies, summed over the AM and PM
 * shifts and capped at a normal day (8 hours). Each half-day is exactly 4 hours (AM 7:30–12:00, PM 1:00–5:00), so a worker in for
 * half a day shows 4.00. Project crew are always paid on the site schedule whatever their department, so this is too.
 * (`department` is kept for the callers that pass it.)
 */
export function regularHours(dayKey: string, i: SheetInput, _department: string | null = "SITE"): number {
  void _department;
  const { am, pm } = sheetShifts(dayKey, i);
  let hours = 0;
  if (am) hours += computeEffectiveHours(am.in, am.out, "SITE", NO_ADJUSTMENTS, true);
  if (pm) hours += computeEffectiveHours(pm.in, pm.out, "SITE", NO_ADJUSTMENTS, true); // no overtime approval here: stops at 5:00 PM
  return Math.round(Math.min(8, hours) * 100) / 100;
}

/**
 * The hours a recorded day is worth under the OFFICE payroll's own rules (8:00 start, lunch off, no morning/afternoon break), capped at
 * a normal day — what the office run will count for someone paid through it. Used for the office panel's grid.
 */
export function regularHoursOffice(dayKey: string, i: SheetInput): number {
  const { am, pm } = sheetShifts(dayKey, i);
  let hours = 0;
  if (am) hours += computeEffectiveHours(am.in, am.out, "OFFICE", NO_ADJUSTMENTS);
  if (pm) hours += computeEffectiveHours(pm.in, pm.out, "OFFICE", NO_ADJUSTMENTS);
  return Math.round(Math.min(8, hours) * 100) / 100;
}

// ----------------------------------------------------------------------------------------------------------------- who may edit

const TIMEKEEPER = /time[\s-]*keeper/i;
/** A person whose job is timekeeper (any spelling: Timekeeper, Time Keeper, Time-keeper, "Timekeeper/Electrician"). */
export const isTimekeeperPosition = (position: string | null | undefined): boolean => !!position && TIMEKEEPER.test(position);

export interface SheetUser {
  role: string;
  position?: string | null;
  /** the sign-in job: a Timekeeper job counts whatever the position says */
  jobRole?: string | null;
  /** the People-page switch for office staff who share the timekeeper sheet and payroll-run work (never the approvals) */
  payrollAssist?: boolean | null;
}

const isTimekeeper = (u: SheetUser) => u.jobRole === "TIMEKEEPER" || isTimekeeperPosition(u.position);

const FOREMAN = /foreman/i;
/** The site foreman (or general foreman) — a leadman is not one — ticks "Checked and reviewed" on the day's sheet. */
export const isForeman = (u: SheetUser): boolean => u.role !== "CLIENT" && (u.role === "FOREMAN" || u.jobRole === "FOREMAN" || u.jobRole === "GENERAL_FOREMAN" || FOREMAN.test(u.position ?? ""));
const ENGINEER = /engineer|engr/i;
/** The project / site engineer — ticks "Approved" once the foreman has checked and reviewed. */
export const isProjectEngineer = (u: SheetUser): boolean => u.role !== "CLIENT" && !isForeman(u) && ENGINEER.test(u.position ?? "");

/** Owner and PM, and the office staff the Owner switched on to share the work (they work the sheet, they never approve overtime). */
const isSheetManager = (u: SheetUser): boolean => u.role === "OWNER" || u.role === "PM" || (u.role !== "CLIENT" && !!u.payrollAssist);

/** Who may open the timekeeper page: the Owner, the PM, the staff sharing the work, timekeepers, and the foreman / project engineer who review it. */
export const canOpenTimesheets = (u: SheetUser): boolean => isSheetManager(u) || (u.role !== "CLIENT" && (isTimekeeper(u) || isForeman(u) || isProjectEngineer(u)));

/** Whether this person works the sheet like the Owner/PM do: any project, any past day, may change a line the engineer already approved. */
export const worksSheetFreely = (u: SheetUser): boolean => isSheetManager(u);

/** Days back a timekeeper may still record or correct; the Owner and PM have no limit (but never the future). */
export const TIMEKEEPER_BACKDATE_DAYS = 14;

/**
 * Whether this person may record this project/day. Owner and PM: any project, any past day. A timekeeper: only a project they are
 * assigned to, for today or the last two weeks. Nobody can record a day that has not happened yet.
 */
export function canEditSheet(
  u: SheetUser,
  ctx: { assignedToProject: boolean; dayKey: string; todayKey: string }
): { ok: true } | { ok: false; reason: string } {
  if (!(isSheetManager(u) || isTimekeeper(u))) return { ok: false, reason: "Only the timekeeper, the PM, the Owner and the staff sharing the work can edit the timekeeper sheet — the foreman and project engineer use the review boxes" };
  if (ctx.dayKey > ctx.todayKey) return { ok: false, reason: "That day has not happened yet" };
  if (isSheetManager(u)) return { ok: true };
  if (!ctx.assignedToProject) return { ok: false, reason: "You are not assigned to this project" };
  const limit = new Date(`${ctx.todayKey}T12:00:00.000Z`).getTime() - TIMEKEEPER_BACKDATE_DAYS * 86_400_000;
  if (new Date(`${ctx.dayKey}T12:00:00.000Z`).getTime() < limit) return { ok: false, reason: `A timekeeper can correct the last ${TIMEKEEPER_BACKDATE_DAYS} days — ask the PM or the Owner for older days` };
  return { ok: true };
}

/** Workers the timekeeper records are the ones with no login of their own (a placeholder email made when they were added). */
export const isNoLoginAccount = (email: string | null | undefined): boolean => !!email && email.toLowerCase().endsWith("@staff.maxeyconstruction.ph");

// ------------------------------------------------------------------------------------------------ adding a worker from the sheet

export interface NewWorkerInput {
  name: string;
  position: string;
  dailyRate: number | null;
  hourlyRate: number | null;
}

export const MAX_DAILY_RATE = 20_000;

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The two rates of a new worker: give either and the other follows (a day is 8 paid hours). Returns the pair, or a reason it
 * cannot be used.
 */
export function workerRates(input: Pick<NewWorkerInput, "dailyRate" | "hourlyRate">): { dailyRate: number; hourlyRate: number } | { error: string } {
  const d = input.dailyRate && input.dailyRate > 0 ? input.dailyRate : null;
  const h = input.hourlyRate && input.hourlyRate > 0 ? input.hourlyRate : null;
  if (!d && !h) return { error: "Enter a daily rate or an hourly rate" };
  const daily = d ?? r2(h! * 8);
  const hourly = h ?? r2(d! / 8);
  if (daily > MAX_DAILY_RATE) return { error: `A daily rate above ₱${MAX_DAILY_RATE.toLocaleString("en-PH")} is not likely — check the amount` };
  if (d && h && Math.abs(r2(h * 8) - d) > 1) return { error: "The daily rate and the hourly rate do not match (hourly × 8 should equal daily) — enter just one of them" };
  return { dailyRate: r2(daily), hourlyRate: r2(hourly) };
}

/** A reason a new worker cannot be added, or null. */
export function validateNewWorker(i: NewWorkerInput): string | null {
  if (i.name.trim().length < 2) return "Enter the worker's name";
  if (i.name.trim().length > 100) return "The name is too long";
  if (i.position.trim().length < 2) return "Enter the worker's position (Mason, Carpenter, Helper…)";
  const rates = workerRates(i);
  return "error" in rates ? rates.error : null;
}

// ------------------------------------------------------------------------------------------- foreman review, engineer approval

/** Where a recorded line stands: recorded by the timekeeper → checked and reviewed by the foreman → approved by the project engineer. */
export type SheetStage = "recorded" | "reviewed" | "approved";

export interface StageFields {
  reviewedAt: Date | string | null;
  engineerApprovedAt: Date | string | null;
}
export const lineStage = (e: StageFields): SheetStage => (e.engineerApprovedAt ? "approved" : e.reviewedAt ? "reviewed" : "recorded");

/** Whether this person may tick the foreman's "Checked and reviewed" box on this project: the Owner/PM, or the foreman assigned to it. */
export const canReviewSheet = (u: SheetUser, ctx: { assignedToProject: boolean }): boolean => u.role === "OWNER" || u.role === "PM" || (isForeman(u) && ctx.assignedToProject);
/** Whether this person may tick the project engineer's "Approved" box on this project: the Owner/PM, or the project engineer assigned to it. */
export const canApproveSheet = (u: SheetUser, ctx: { assignedToProject: boolean }): boolean => u.role === "OWNER" || u.role === "PM" || (isProjectEngineer(u) && ctx.assignedToProject);

export interface ReviewLine {
  userId: string;
  stage: SheetStage;
}

/**
 * What ticking (or unticking) one box does to a line, or why it can't:
 *  - review: only a recorded line; approve: only a line the foreman has already reviewed;
 *  - unreview: a reviewed line that the engineer has not approved (take the approval back first); unapprove: an approved line.
 * Returns the stage the line moves to, or a reason.
 */
export function nextStage(step: "review" | "approve", checked: boolean, from: SheetStage): { to: SheetStage } | { error: string } {
  if (step === "review") {
    if (checked) return from === "recorded" ? { to: "reviewed" } : { error: from === "reviewed" ? "already checked and reviewed" : "already approved" };
    if (from === "approved") return { error: "the project engineer has approved it — the approval has to be taken back first" };
    return from === "reviewed" ? { to: "recorded" } : { error: "not checked yet" };
  }
  if (checked) {
    if (from === "recorded") return { error: "the foreman has not checked and reviewed it yet" };
    return from === "reviewed" ? { to: "approved" } : { error: "already approved" };
  }
  return from === "approved" ? { to: "reviewed" } : { error: "not approved yet" };
}

/** Counts for the banner above the sheet: lines recorded, and how many of them are reviewed / approved. */
export function sheetProgress(lines: ReviewLine[]): { recorded: number; reviewed: number; approved: number; allReviewed: boolean; allApproved: boolean } {
  const recorded = lines.length;
  const approved = lines.filter((l) => l.stage === "approved").length;
  const reviewed = lines.filter((l) => l.stage !== "recorded").length;
  return { recorded, reviewed, approved, allReviewed: recorded > 0 && reviewed === recorded, allApproved: recorded > 0 && approved === recorded };
}

/** Whether a change to a saved line is a real change to what was recorded (times, overtime, absence) — remarks alone are not. */
export function changesRecord(before: { amIn: string | null; amOut: string | null; pmIn: string | null; pmOut: string | null; otHours: number | null; absent: boolean }, after: SheetInput): boolean {
  const n = (v: string | null | undefined) => (v ? v : null);
  return n(before.amIn) !== n(after.amIn) || n(before.amOut) !== n(after.amOut) || n(before.pmIn) !== n(after.pmIn) || n(before.pmOut) !== n(after.pmOut) || (before.otHours ?? 0) !== (after.otHours ?? 0) || before.absent !== after.absent;
}

// ---------------------------------------------------------------------------------------------------- Sunday work and late approval

/** Whether a Manila calendar day ("2026-11-08") is a Sunday. */
export const isSundayKey = (dayKey: string): boolean => new Date(`${dayKey}T12:00:00.000Z`).getUTCDay() === 0;

export type WeekendStatus = "PENDING" | "APPROVED" | "REJECTED";

/**
 * What happens to a Sunday line when it is saved. Only the Owner approves Sunday work: his own lines are approved at once; anyone
 * else's wait (PENDING) and make no clock records, so they are not paid until he approves. A line already approved stays approved
 * if nothing about it changed; a real change sends it back for approval, and a rejected line stays rejected until it is changed.
 * Returns null on any other day.
 */
export function sundayStatusOnSave(p: { dayKey: string; actorIsOwner: boolean; existing: WeekendStatus | null; changed: boolean }): WeekendStatus | null {
  if (!isSundayKey(p.dayKey)) return null;
  if (p.actorIsOwner) return "APPROVED";
  if (p.existing === "APPROVED" && !p.changed) return "APPROVED";
  if (p.existing === "REJECTED" && !p.changed) return "REJECTED";
  return "PENDING";
}

/** True when a day has passed but the project engineer has not approved everything that was recorded for it. */
export function approvalOverdue(dayKey: string, todayKey: string, progress: { recorded: number; allApproved: boolean }): boolean {
  return dayKey < todayKey && progress.recorded > 0 && !progress.allApproved;
}

/** The sentence for the banner / alert, naming who is holding things up. */
export function overdueText(p: { reviewed: number; approved: number; recorded: number }): string {
  if (p.approved >= p.recorded) return "";
  if (p.reviewed < p.recorded) return `${p.recorded - p.reviewed} of ${p.recorded} lines are not checked and reviewed by the foreman yet, and ${p.recorded - p.approved} are not approved by the project engineer`;
  return `the foreman has checked and reviewed it, but ${p.recorded - p.approved} of ${p.recorded} lines are still waiting for the project engineer's approval`;
}
