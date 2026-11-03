import { manilaDayKey, manilaTime } from "@/lib/time-rules";

/** The time-out the Owner sets for a shift someone forgot to close: Manila time on the day the shift started. */
export function forcedTimeOut(timeIn: Date, time: string, now: Date): { ok: true; at: Date } | { ok: false; error: string } {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!m) return { ok: false, error: "Write the time like 17:00" };
  const at = manilaTime(manilaDayKey(timeIn), Number(m[1]), Number(m[2]));
  if (at.getTime() <= timeIn.getTime()) return { ok: false, error: "The time-out must be after the time-in" };
  if (at.getTime() > now.getTime()) return { ok: false, error: "The time-out cannot be in the future" };
  return { ok: true, at };
}

const hhmm = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);

/** What to suggest: 5:00 PM of the shift's day — the end of the working day for someone with no overtime — or "now" if that is still ahead. */
export function defaultForcedTimeOut(timeIn: Date, now: Date): string {
  const five = manilaTime(manilaDayKey(timeIn), 17, 0);
  if (five.getTime() > timeIn.getTime() && five.getTime() <= now.getTime()) return "17:00";
  if (now.getTime() > timeIn.getTime() && manilaDayKey(now) === manilaDayKey(timeIn)) return hhmm(new Date(Math.floor(now.getTime() / 60000) * 60000));
  return "23:59"; // clocked in after 5 PM on an earlier day: end of that day
}
