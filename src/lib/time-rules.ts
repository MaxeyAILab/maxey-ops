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
