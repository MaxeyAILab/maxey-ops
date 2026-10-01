/**
 * Business rules for turning a raw clock-in/clock-out span into worked
 * hours: a scheduled-start clamp (so arriving early doesn't inflate pay), a
 * fixed 5:00 PM cutoff, and break deductions — all evaluated in Manila local
 * time regardless of server timezone. An approved TimeAdjustmentRequest
 * lifts the relevant clamp for that one shift; nothing here ever touches the
 * underlying Attendance row, which stays the untouched source of truth.
 *
 * Department mapping: SITE and DRIVER follow the "site" schedule (7:30 AM
 * start, morning/afternoon breaks, early-start requests allowed); OFFICE,
 * ARCHITECT, and ENGINEER follow the simpler "office" schedule (8:00 AM
 * start, no breaks beyond lunch, no early-start request — there's nothing to
 * request since there's no rule allowing site-style early credit for desk
 * staff). Both schedules share the 12:00–1:00 PM lunch deduction and the
 * 5:00 PM cutoff (liftable by an approved overtime request).
 */

export type TimeRuleset = "OFFICE" | "SITE";

export interface AdjustmentFlags {
  earlyStartApproved: boolean;
  overtimeApproved: boolean;
  /** An approved WEEKEND_WORK request for this shift's Manila calendar day —
   * exempts the whole shift from every clamp (start, breaks, 5pm cutoff),
   * since a weekend shift has no scheduled hours to begin with. */
  weekendApproved: boolean;
}

const NO_ADJUSTMENTS: AdjustmentFlags = {
  earlyStartApproved: false,
  overtimeApproved: false,
  weekendApproved: false,
};

/** Office/Driver are the two departments the weekend lockout applies to:
 * force-closed at 5pm Saturday, blocked from clocking in at all on Sunday. */
export function isWeekendRestrictedDepartment(department: string | null | undefined): boolean {
  return department === "OFFICE" || department === "DRIVER";
}

/** 0 (Sunday) – 6 (Saturday), evaluated in Manila local time regardless of
 * server timezone. */
export function manilaDayOfWeek(d: Date): number {
  const dayKey = manilaDayKey(d);
  return new Date(`${dayKey}T12:00:00.000Z`).getUTCDay();
}

export function isManilaSaturday(d: Date): boolean {
  return manilaDayOfWeek(d) === 6;
}

export function isManilaSunday(d: Date): boolean {
  return manilaDayOfWeek(d) === 0;
}

const manilaDayKeyFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Manila",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function manilaDayKey(d: Date): string {
  return manilaDayKeyFmt.format(d);
}

/** A specific hour:minute on the given Manila calendar day, as a UTC instant. */
export function manilaTime(dayKey: string, hour: number, minute: number): Date {
  return new Date(`${dayKey}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000+08:00`);
}

const SCHEDULE_START: Record<TimeRuleset, { h: number; m: number }> = {
  OFFICE: { h: 8, m: 0 },
  SITE: { h: 7, m: 30 },
};
const DAY_END = { h: 17, m: 0 }; // 5:00 PM, both rulesets
const LUNCH = { startH: 12, startM: 0, endH: 13, endM: 0 };
const SITE_BREAKS = [
  { startH: 10, startM: 0, endH: 10, endM: 15 }, // morning break
  { startH: 15, startM: 0, endH: 15, endM: 15 }, // afternoon break
];

function overlapMs(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

/** Which schedule a department follows. Drivers get site rules (their own
 * early-delivery scenario needs the early-start request); Architect/Engineer
 * get office rules. */
export function rulesetForDepartment(department: string | null | undefined): TimeRuleset {
  return department === "SITE" || department === "DRIVER" ? "SITE" : "OFFICE";
}

/**
 * Effective worked hours for one shift, after the scheduled-start clamp,
 * lunch (and, for SITE, morning/afternoon break) deductions, and the 5pm
 * cutoff — unless an approved request lifts the relevant clamp.
 */
export function computeEffectiveHours(
  timeIn: Date,
  timeOut: Date,
  ruleset: TimeRuleset,
  flags: AdjustmentFlags = NO_ADJUSTMENTS
): number {
  // An approved weekend-work day is unscheduled bonus work by definition —
  // no start clamp, no breaks, no 5pm cutoff, just the raw span.
  if (flags.weekendApproved) {
    return Math.max(0, (timeOut.getTime() - timeIn.getTime()) / 3_600_000);
  }

  const dayKey = manilaDayKey(timeIn);
  const start = SCHEDULE_START[ruleset];
  const scheduledStart = manilaTime(dayKey, start.h, start.m).getTime();
  const dayEnd = manilaTime(dayKey, DAY_END.h, DAY_END.m).getTime();

  let effStart = timeIn.getTime();
  if (effStart < scheduledStart && !flags.earlyStartApproved) effStart = scheduledStart;

  let effEnd = timeOut.getTime();
  if (effEnd > dayEnd && !flags.overtimeApproved) effEnd = dayEnd;

  if (effEnd <= effStart) return 0;

  let ms = effEnd - effStart;

  const lunchStart = manilaTime(dayKey, LUNCH.startH, LUNCH.startM).getTime();
  const lunchEnd = manilaTime(dayKey, LUNCH.endH, LUNCH.endM).getTime();
  ms -= overlapMs(effStart, effEnd, lunchStart, lunchEnd);

  if (ruleset === "SITE") {
    for (const b of SITE_BREAKS) {
      const bs = manilaTime(dayKey, b.startH, b.startM).getTime();
      const be = manilaTime(dayKey, b.endH, b.endM).getTime();
      ms -= overlapMs(effStart, effEnd, bs, be);
    }
  }

  return Math.max(0, ms / 3_600_000);
}

/** Whether a shift's raw time-in is early enough to be worth requesting
 * credit for (SITE only — office has no early-start request). */
export function isEarlyStart(timeIn: Date, ruleset: TimeRuleset): boolean {
  if (ruleset !== "SITE") return false;
  const dayKey = manilaDayKey(timeIn);
  const start = SCHEDULE_START.SITE;
  return timeIn.getTime() < manilaTime(dayKey, start.h, start.m).getTime();
}

/** Whether a shift's raw time-out runs past the 5pm cutoff. */
export function isOvertime(timeOut: Date): boolean {
  const dayKey = manilaDayKey(timeOut);
  return timeOut.getTime() > manilaTime(dayKey, DAY_END.h, DAY_END.m).getTime();
}

// ---------------------------------------------------------------------------
// Pay-period boundaries. Office/Architect/Engineer are paid semi-monthly
// (1st–15th, 16th–end); Site (project) crews and Drivers are paid weekly,
// Friday 5:01 PM to the following Friday 5:00 PM. Both are computed here —
// never picked from a free date range — so a run can't drift out of
// alignment with the last one.
// ---------------------------------------------------------------------------

export function manilaMonthKey(d: Date): string {
  return manilaDayKey(d).slice(0, 7); // "YYYY-MM"
}

/** Count of Monday–Saturday calendar days in the given "YYYY-MM" month —
 * the divisor for turning a monthly salary into a daily rate (Spec: office
 * works Mon–Sat, so only Sundays are excluded; no holiday calendar exists in
 * this app to exclude further). */
export function workingDaysInManilaMonth(monthKey: string): number {
  const [year, month] = monthKey.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  let count = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    const dayKey = `${monthKey}-${String(day).padStart(2, "0")}`;
    const dow = new Date(`${dayKey}T12:00:00.000Z`).getUTCDay();
    if (dow !== 0) count++; // every day but Sunday
  }
  return count;
}

export interface SemiMonthlyPeriod {
  start: Date;
  end: Date;
  monthKey: string; // the calendar month the whole period falls in — the divisor for the daily rate
  label: string;
}

/** The semi-monthly period (1st–15th or 16th–end) containing `now`, or an
 * earlier one when `periodsBack > 0` (1 = the previous half-month, etc.). */
export function manilaSemiMonthlyPeriod(now: Date, periodsBack = 0): SemiMonthlyPeriod {
  const dayKey = manilaDayKey(now);
  const [year, month, dom] = dayKey.split("-").map(Number);
  // Walk back one half-month period at a time so month/year rollovers (and
  // variable month lengths) are handled by Date arithmetic, not by hand.
  let y = year;
  let m = month; // 1-12
  let firstHalf = dom <= 15;
  for (let i = 0; i < periodsBack; i++) {
    if (firstHalf) {
      m -= 1;
      if (m === 0) {
        m = 12;
        y -= 1;
      }
      firstHalf = false; // land on the second half of the previous month
    } else {
      firstHalf = true; // land on the first half of the same month
    }
  }
  const monthKey = `${y}-${String(m).padStart(2, "0")}`;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const start = firstHalf ? manilaTime(`${monthKey}-01`, 0, 0) : manilaTime(`${monthKey}-16`, 0, 0);
  const endDay = firstHalf ? 15 : daysInMonth;
  const end = manilaTime(`${monthKey}-${String(endDay).padStart(2, "0")}`, 23, 59);
  const monthLabel = new Date(`${monthKey}-01T00:00:00Z`).toLocaleString("en-US", { month: "long", timeZone: "UTC" });
  return {
    start,
    end,
    monthKey,
    label: firstHalf ? `${monthLabel} 1–15, ${y}` : `${monthLabel} 16–${endDay}, ${y}`,
  };
}

export interface WeeklySitePeriod {
  start: Date;
  end: Date;
  label: string;
}

/** The Friday-5:01PM-to-Friday-5:00PM week containing `now`, or an earlier
 * one when `periodsBack > 0`. */
export function manilaWeeklySitePeriod(now: Date, periodsBack = 0): WeeklySitePeriod {
  const dow = manilaDayOfWeek(now); // 0=Sun..6=Sat, Friday=5
  const daysSinceFriday = (dow - 5 + 7) % 7;
  const thisWeekFridayKey = manilaDayKey(new Date(now.getTime() - daysSinceFriday * 86_400_000));
  const thisFriday5pm = manilaTime(thisWeekFridayKey, 17, 0);

  let end = now.getTime() <= thisFriday5pm.getTime() ? thisFriday5pm : new Date(thisFriday5pm.getTime() + 7 * 86_400_000);
  let start = new Date(end.getTime() - 7 * 86_400_000 + 60_000); // +1 minute past the prior Friday 5pm

  for (let i = 0; i < periodsBack; i++) {
    end = new Date(end.getTime() - 7 * 86_400_000);
    start = new Date(start.getTime() - 7 * 86_400_000);
  }

  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric" });
  return { start, end, label: `${fmt.format(start)} – ${fmt.format(end)}` };
}
