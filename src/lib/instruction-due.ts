/**
 * Due dates of instructions (owner's request 2026-11-22): a daily reminder to the people doing a task once it is due, and the
 * extension request they can send when they truly need more time. Pure rules, shared by the API, the daily reminder, the pages
 * and the tests. Dates are Manila calendar days as "YYYY-MM-DD".
 */

/** A task still waiting on the people doing it (done-and-waiting-for-review and closed tasks are not chased). */
export const needsDoing = (status: string): boolean => !["FOR_REVIEW", "COMPLETED", "CANCELLED"].includes(status);

/** Still open at all (an extension can be asked while it is anything but completed / cancelled). */
export const isOpenTask = (status: string): boolean => !["COMPLETED", "CANCELLED"].includes(status);

/** Whole days from one day key to another (positive when `to` is later). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Where a task stands against its target date today: "overdue", "today", or null (not due yet / no date / not ours to chase). */
export function dueState(dueKey: string | null, todayKey: string, status: string): "overdue" | "today" | null {
  if (!dueKey || !needsDoing(status)) return null;
  if (dueKey < todayKey) return "overdue";
  if (dueKey === todayKey) return "today";
  return null;
}

const SHORT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
export const shortDay = (key: string) => SHORT.format(new Date(`${key}T00:00:00Z`));

/** The daily reminder's wording for one task. */
export function reminderMessage(p: { title: string; taskId: string | null; where: string; dueKey: string; todayKey: string }): { title: string; body: string } {
  const late = daysBetween(p.dueKey, p.todayKey);
  const ref = [p.taskId, p.where].filter(Boolean).join(" · ");
  const ask = "Update the status, or request an extension if you really need more time.";
  return late <= 0
    ? { title: `Due today: ${p.title}`, body: `${ref} — ${ask}` }
    : { title: `Overdue ${late} day${late === 1 ? "" : "s"}: ${p.title}`, body: `${ref} — target was ${shortDay(p.dueKey)}. ${ask}` };
}

/** The longest a single extension may push a target date. */
export const MAX_EXTENSION_DAYS = 60;
export const MIN_REASON_CHARS = 10;

/** Why an extension request can't be sent, or null when it can. */
export function extensionProblem(p: { status: string; dueKey: string | null; proposedKey: string; todayKey: string; reason: string; pending: boolean }): string | null {
  if (!isOpenTask(p.status)) return "This task is already closed";
  if (!p.dueKey) return "This task has no target date to extend";
  if (p.pending) return "An extension request is already waiting for the Owner/PM";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.proposedKey)) return "Pick the new target date";
  if (p.proposedKey < p.todayKey) return "The new date can't be in the past";
  if (p.proposedKey <= p.dueKey) return `The new date must be after the current target (${shortDay(p.dueKey)})`;
  if (daysBetween(p.dueKey, p.proposedKey) > MAX_EXTENSION_DAYS) return `An extension can add at most ${MAX_EXTENSION_DAYS} days — ask again later if needed`;
  if (p.reason.trim().length < MIN_REASON_CHARS) return "Say why the extension is needed (a short sentence)";
  return null;
}

/** Who may ask for more time: the people doing the task (assignees, or a foreman for a whole-team task). The Owner/PM edit the date. */
export const canAskExtension = (p: { role: string; isAssignee: boolean; broadcast: boolean }): boolean =>
  !["OWNER", "PM", "CLIENT"].includes(p.role) && (p.isAssignee || (p.broadcast && p.role === "FOREMAN"));

/** Who is reminded about a due task: its assignees; for a whole-team task the foremen on its project, else whoever posted it. */
export function reminderRecipients(p: { assigneeIds: string[]; projectForemanIds: string[]; postedById: string }): string[] {
  if (p.assigneeIds.length > 0) return [...new Set(p.assigneeIds)];
  if (p.projectForemanIds.length > 0) return [...new Set(p.projectForemanIds)];
  return [p.postedById];
}
