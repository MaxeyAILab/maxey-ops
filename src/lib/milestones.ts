/**
 * Milestone dates are calendar days stored without a time of day (UTC
 * midnight of that date), so variances are whole days and can't shift with
 * timezones. "Today" is always the Manila calendar day.
 */

export type MilestoneStatusLike = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "BLOCKED";

export type MilestoneHealth =
  | "complete"
  | "complete-late"
  | "on-track"
  | "watch"
  | "late"
  | "overdue"
  | "blocked"
  | "no-baseline"
  | "no-dates";

/**
 * Documented default thresholds (days a forecast finish may slip past the
 * approved baseline): any slip is "watch", more than `lateDays` is "late".
 * Kept as a parameter rather than hard-coded so a project setting can
 * override it later.
 */
export const DEFAULT_THRESHOLDS = { lateDays: 7 };

const DAY = 86_400_000;

/** Day index (days since epoch) of a date-only value. */
export function dayIndex(d: Date | null | undefined): number | null {
  return d ? Math.floor(d.getTime() / DAY) : null;
}

/** Day index of today's Manila calendar date. */
export function manilaToday(now: Date): number {
  const key = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(now); // YYYY-MM-DD
  return Math.floor(new Date(`${key}T00:00:00Z`).getTime() / DAY);
}

/** Parse a YYYY-MM-DD string to a date-only value; null for blank. */
export function parseDateOnly(value: string | null | undefined): Date | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Invalid date");
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) throw new Error("Invalid date");
  return d;
}

export interface MilestoneDates {
  status: MilestoneStatusLike;
  baselineFinish: Date | null;
  forecastFinish: Date | null;
  actualFinish: Date | null;
}

export interface MilestoneHealthResult {
  health: MilestoneHealth;
  /** Forecast (or actual, once complete) finish minus baseline finish, in days; null if either is missing. */
  varianceDays: number | null;
  /** Days past the current finish date for an open milestone; null otherwise. */
  overdueDays: number | null;
}

export function computeMilestoneHealth(
  m: MilestoneDates,
  now: Date,
  thresholds = DEFAULT_THRESHOLDS
): MilestoneHealthResult {
  const baseline = dayIndex(m.baselineFinish);
  const forecast = dayIndex(m.forecastFinish);
  const actual = dayIndex(m.actualFinish);
  const today = manilaToday(now);

  if (m.status === "COMPLETED") {
    const variance = actual != null && baseline != null ? actual - baseline : null;
    return {
      health: variance != null && variance > thresholds.lateDays ? "complete-late" : "complete",
      varianceDays: variance,
      overdueDays: null,
    };
  }

  const current = forecast ?? baseline;
  const variance = forecast != null && baseline != null ? forecast - baseline : null;

  if (m.status === "BLOCKED") return { health: "blocked", varianceDays: variance, overdueDays: current != null && today > current ? today - current : null };
  if (current == null) return { health: "no-dates", varianceDays: null, overdueDays: null };
  if (today > current) return { health: "overdue", varianceDays: variance, overdueDays: today - current };
  if (baseline == null) return { health: "no-baseline", varianceDays: null, overdueDays: null };
  if (variance == null || variance <= 0) return { health: "on-track", varianceDays: variance, overdueDays: null };
  return { health: variance > thresholds.lateDays ? "late" : "watch", varianceDays: variance, overdueDays: null };
}

/** Open milestones due within `withinDays` (or already overdue), soonest first. */
export function upcomingMilestones<T extends MilestoneDates>(
  milestones: T[],
  now: Date,
  withinDays = 30
): T[] {
  const today = manilaToday(now);
  return milestones
    .filter((m) => m.status !== "COMPLETED")
    .map((m) => ({ m, due: dayIndex(m.forecastFinish ?? m.baselineFinish) }))
    .filter((x): x is { m: T; due: number } => x.due != null && x.due <= today + withinDays)
    .sort((a, b) => a.due - b.due)
    .map((x) => x.m);
}
