import type { MilestoneHealth } from "@/lib/milestones";

export interface TimelineMilestone {
  id: string;
  title: string;
  status: string;
  health: MilestoneHealth;
  baselineStart: string | null; // YYYY-MM-DD
  baselineFinish: string | null;
  forecastStart: string | null;
  forecastFinish: string | null;
  actualFinish: string | null;
}

export const HEALTH_LABEL: Record<MilestoneHealth, string> = {
  complete: "Complete",
  "complete-late": "Completed late",
  "on-track": "On track",
  watch: "Slipping",
  late: "Late",
  overdue: "Overdue",
  blocked: "Blocked",
  "no-baseline": "No baseline",
  "no-dates": "No dates",
};

export const HEALTH_ICON: Record<MilestoneHealth, string> = {
  complete: "✓",
  "complete-late": "●",
  "on-track": "✓",
  watch: "●",
  late: "▲",
  overdue: "▲",
  blocked: "▲",
  "no-baseline": "○",
  "no-dates": "○",
};

export const HEALTH_CHIP: Record<MilestoneHealth, string> = {
  complete: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
  "complete-late": "bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300",
  "on-track": "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
  watch: "bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300",
  late: "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300",
  overdue: "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300",
  blocked: "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300",
  "no-baseline": "bg-ink-200 text-ink-700",
  "no-dates": "bg-ink-200 text-ink-700",
};

const BAR: Record<MilestoneHealth, string> = {
  complete: "bg-emerald-500",
  "complete-late": "bg-amber-500",
  "on-track": "bg-emerald-500",
  watch: "bg-amber-500",
  late: "bg-red-500",
  overdue: "bg-red-500",
  blocked: "bg-red-500",
  "no-baseline": "bg-ink-400",
  "no-dates": "bg-ink-400",
};

const DAY = 86_400_000;
const idx = (iso: string | null) => (iso ? Math.floor(new Date(`${iso}T00:00:00Z`).getTime() / DAY) : null);
const monthFmt = new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * Milestone timeline: for each milestone a thin outlined bar for the approved
 * baseline and a solid bar for the current forecast (a diamond when only a
 * finish date exists), with a line for today. It is a plan-vs-forecast view of
 * milestones, not a task schedule — there are no dependencies. Hidden on
 * narrow screens, where the milestone list below carries the same information.
 */
export function MilestoneTimeline({ milestones, today }: { milestones: TimelineMilestone[]; today: string }) {
  const rows = milestones.filter((m) => m.baselineFinish || m.forecastFinish || m.actualFinish);
  if (rows.length === 0) return null;

  const nums: number[] = [idx(today)!];
  for (const m of rows)
    for (const v of [m.baselineStart, m.baselineFinish, m.forecastStart, m.forecastFinish, m.actualFinish]) {
      const n = idx(v);
      if (n != null) nums.push(n);
    }
  const min = Math.min(...nums) - 3;
  const max = Math.max(...nums) + 3;
  const span = Math.max(max - min, 1);
  const pos = (n: number) => ((n - min) / span) * 100;
  const todayPos = pos(idx(today)!);
  const ticks = Array.from({ length: 5 }, (_, i) => min + Math.round((span * i) / 4));

  return (
    <div className="hidden md:block" role="img" aria-label="Milestone timeline comparing baseline and forecast dates">
      <div className="grid grid-cols-[180px_1fr] gap-x-3">
        <div />
        <div className="relative mb-1 h-4 text-[10px] text-ink-500">
          {ticks.map((t) => (
            <span key={t} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${pos(t)}%` }}>
              {monthFmt.format(new Date(t * DAY))}
            </span>
          ))}
        </div>
        {rows.map((m) => {
          const bs = idx(m.baselineStart) ?? idx(m.baselineFinish);
          const bf = idx(m.baselineFinish) ?? idx(m.baselineStart);
          const finish = idx(m.actualFinish) ?? idx(m.forecastFinish);
          const fs = idx(m.forecastStart) ?? finish;
          return (
            <div key={m.id} className="contents">
              <div className="truncate py-2 pr-2 text-xs font-medium text-ink-800" title={m.title}>
                {m.title}
              </div>
              <div className="relative h-9 border-t border-ink-100">
                {ticks.map((t) => (
                  <span key={t} className="absolute top-0 h-full border-l border-ink-100" style={{ left: `${pos(t)}%` }} />
                ))}
                {bs != null && bf != null && (
                  <span
                    className="absolute top-1.5 h-2 rounded-sm border border-ink-400 bg-ink-100/60"
                    style={{ left: `${pos(bs)}%`, width: `${Math.max(pos(bf) - pos(bs), 0.8)}%` }}
                    title="Approved baseline"
                  />
                )}
                {finish != null && fs != null && (
                  <span
                    className={`absolute top-4 h-2.5 rounded-sm ${BAR[m.health]}`}
                    style={{ left: `${pos(fs)}%`, width: `${Math.max(pos(finish) - pos(fs), 1)}%` }}
                    title="Current forecast"
                  />
                )}
                <span className="absolute top-0 h-full border-l-2 border-brand-500/70" style={{ left: `${todayPos}%` }} />
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] text-ink-500">
        <span className="mr-1 inline-block h-2 w-5 rounded-sm border border-ink-400 bg-ink-100/60 align-middle" /> approved baseline ·{" "}
        <span className="mr-1 inline-block h-2.5 w-5 rounded-sm bg-emerald-500 align-middle" /> current forecast (colour shows status) ·{" "}
        <span className="mr-1 inline-block h-3 border-l-2 border-brand-500/70 align-middle" /> today
      </p>
    </div>
  );
}
