import { computeEffectiveHours, manilaTime, rulesetForDepartment } from "@/lib/time-rules";

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
 * The paid hours for the day before any overtime is approved: the same clamps, lunch and break deductions payroll applies, summed
 * over the AM and PM shifts and capped at a normal day (8 hours).
 */
export function regularHours(dayKey: string, i: SheetInput, department: string | null = "SITE"): number {
  const { am, pm } = sheetShifts(dayKey, i);
  const ruleset = rulesetForDepartment(department);
  let hours = 0;
  if (am) hours += computeEffectiveHours(am.in, am.out, ruleset);
  if (pm) hours += computeEffectiveHours(pm.in, pm.out, ruleset); // no overtime approval here: stops at 5:00 PM
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
}

const isTimekeeper = (u: SheetUser) => u.jobRole === "TIMEKEEPER" || isTimekeeperPosition(u.position);

/** Who may open the timekeeper page: the Owner, the PM and timekeepers. */
export const canOpenTimesheets = (u: SheetUser): boolean => u.role === "OWNER" || u.role === "PM" || (u.role !== "CLIENT" && isTimekeeper(u));

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
  if (!canOpenTimesheets(u)) return { ok: false, reason: "Only the timekeeper, the PM and the Owner can edit the timekeeper sheet" };
  if (ctx.dayKey > ctx.todayKey) return { ok: false, reason: "That day has not happened yet" };
  if (u.role === "OWNER" || u.role === "PM") return { ok: true };
  if (!ctx.assignedToProject) return { ok: false, reason: "You are not assigned to this project" };
  const limit = new Date(`${ctx.todayKey}T12:00:00.000Z`).getTime() - TIMEKEEPER_BACKDATE_DAYS * 86_400_000;
  if (new Date(`${ctx.dayKey}T12:00:00.000Z`).getTime() < limit) return { ok: false, reason: `A timekeeper can correct the last ${TIMEKEEPER_BACKDATE_DAYS} days — ask the PM or the Owner for older days` };
  return { ok: true };
}

/** Workers the timekeeper records are the ones with no login of their own (a placeholder email made when they were added). */
export const isNoLoginAccount = (email: string | null | undefined): boolean => !!email && email.toLowerCase().endsWith("@staff.maxeyconstruction.ph");
