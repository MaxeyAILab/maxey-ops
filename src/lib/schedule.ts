export type ScheduleState = "on-plan" | "watch" | "late" | "overdue" | "done" | "no-target" | "unknown";

export interface Schedule {
  state: ScheduleState;
  /** Days past target (overdue) or forecast days vs target (once ≥25% done). */
  varianceDays: number | null;
  /** Share of the start→target window already used, 0–100. */
  plannedPct: number | null;
  forecastFinish: Date | null;
}

const DAY = 86_400_000;
const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / DAY);

/**
 * Schedule performance: compares how much of the time window is used with how
 * much verified work is done. Straight-line date extrapolation is unreliable
 * early on (jobs start slow), so the state is driven by this gap; a forecast
 * finish is only offered from 25% progress.
 */
export function computeSchedule(input: {
  now: Date;
  start: Date | null;
  targetEnd: Date | null;
  pct: number;
  isCompleted: boolean;
}): Schedule {
  const { now, start, targetEnd, pct, isCompleted } = input;
  if (isCompleted) return { state: "done", varianceDays: null, plannedPct: null, forecastFinish: null };
  if (!targetEnd) return { state: "no-target", varianceDays: null, plannedPct: null, forecastFinish: null };
  if (now > targetEnd && pct < 100)
    return { state: "overdue", varianceDays: daysBetween(targetEnd, now), plannedPct: null, forecastFinish: null };
  if (start && targetEnd > start && now > start) {
    const plannedPct = Math.min(100, ((now.getTime() - start.getTime()) / (targetEnd.getTime() - start.getTime())) * 100);
    const gap = plannedPct - pct;
    const state: ScheduleState =
      pct < 5 && plannedPct < 15 ? "unknown" : gap > 30 ? "late" : gap > 15 ? "watch" : "on-plan";
    let forecastFinish: Date | null = null;
    let varianceDays: number | null = null;
    if (pct >= 25) {
      forecastFinish = new Date(start.getTime() + (now.getTime() - start.getTime()) / (pct / 100));
      varianceDays = daysBetween(targetEnd, forecastFinish);
    }
    return { state, varianceDays, plannedPct, forecastFinish };
  }
  return { state: "unknown", varianceDays: null, plannedPct: null, forecastFinish: null };
}
