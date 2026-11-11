import { prisma } from "@/lib/prisma";
import { notifyPeople } from "@/lib/notify-people";
import { approvalOverdue, isForeman, isProjectEngineer, isTimekeeperPosition, lineStage, overdueText, sheetProgress } from "@/lib/timesheet";
import { manilaDayKey } from "@/lib/time-rules";
import { isOfficePaidOn } from "@/lib/office-payroll";

/**
 * Phone / inbox alerts of the timekeeper sheet — who is told when:
 *  - the timekeeper has recorded a day            → the project's foreman (time to check and review it)
 *  - the foreman has checked and reviewed all of it → the project's engineer (time to approve it)
 *  - Sunday work was recorded by someone but the Owner → the Owner (it waits for him)
 *  - a Sunday line was approved / rejected         → whoever recorded it
 *  - a day has passed and the engineer has not approved all of it → engineer, foreman, timekeeper, Owner and the office staff
 * Messages name the project and the day, never an amount.
 */
const CATEGORY = "ATTENDANCE";
const dayText = (dayKey: string) => new Date(`${dayKey}T12:00:00.000Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
export const sheetUrl = (projectId: string, dayKey: string) => `/attendance/timekeeper?project=${projectId}&date=${dayKey}`;

export interface SheetAudience {
  foremen: string[];
  engineers: string[];
  timekeepers: string[];
  owners: string[];
  /** the office staff who share the payroll work (switch on People) and Accounting */
  office: string[];
}

/** The people around a project's sheet: its foreman(s), engineer(s) and timekeeper(s) from the roster, plus the Owner and the office staff. */
export async function sheetAudience(projectId: string): Promise<SheetAudience> {
  const [roster, owners, office] = await Promise.all([
    prisma.projectAssignment.findMany({ where: { projectId, active: true }, select: { user: { select: { id: true, role: true, position: true, jobRole: true, active: true } } } }),
    prisma.user.findMany({ where: { role: "OWNER", active: true }, select: { id: true } }),
    prisma.user.findMany({ where: { active: true, role: { not: "CLIENT" }, OR: [{ payrollAssist: true }, { role: "ACCOUNTING" }] }, select: { id: true } }),
  ]);
  const people = roster.map((r) => r.user).filter((u) => u.active);
  return {
    foremen: people.filter(isForeman).map((u) => u.id),
    engineers: people.filter(isProjectEngineer).map((u) => u.id),
    timekeepers: people.filter((u) => u.jobRole === "TIMEKEEPER" || isTimekeeperPosition(u.position)).map((u) => u.id),
    owners: owners.map((u) => u.id),
    office: office.map((u) => u.id),
  };
}

const without = (ids: string[], actorId?: string | null) => ids.filter((id) => id !== actorId);

/** The timekeeper recorded (or changed) lines → tell the foreman it is ready to check and review. */
export async function alertReadyForReview(p: { projectId: string; projectName: string; dayKey: string; lines: number; actorId: string; actorName: string }) {
  const a = await sheetAudience(p.projectId);
  return notifyPeople(without(a.foremen, p.actorId), {
    category: CATEGORY,
    title: `Timekeeper sheet ready to check — ${p.projectName}`,
    body: `${p.actorName} recorded ${p.lines} line${p.lines === 1 ? "" : "s"} for ${dayText(p.dayKey)}. Tap to check and review`,
    url: sheetUrl(p.projectId, p.dayKey),
    tag: `ts-ready:${p.projectId}:${p.dayKey}`,
  });
}

/** The foreman has now checked and reviewed every recorded line → tell the project engineer it waits for his approval. */
export async function alertReviewFinished(p: { projectId: string; projectName: string; dayKey: string; actorId: string; actorName: string }) {
  const a = await sheetAudience(p.projectId);
  return notifyPeople(without(a.engineers, p.actorId), {
    category: CATEGORY,
    title: `Sheet checked and reviewed — ${p.projectName}`,
    body: `${p.actorName} finished checking ${dayText(p.dayKey)}. It is waiting for your approval — tap to open`,
    url: sheetUrl(p.projectId, p.dayKey),
    tag: `ts-reviewed:${p.projectId}:${p.dayKey}`,
  });
}

/** Sunday work was recorded by someone other than the Owner → it waits for him. */
export async function alertSundayPending(p: { projectId: string; projectName: string; dayKey: string; lines: number; actorId: string; actorName: string }) {
  const a = await sheetAudience(p.projectId);
  return notifyPeople(without(a.owners, p.actorId), {
    category: CATEGORY,
    title: `Sunday work waiting for your approval — ${p.projectName}`,
    body: `${p.actorName} recorded ${p.lines} worker${p.lines === 1 ? "" : "s"} for ${dayText(p.dayKey)}. Not paid until you approve — tap to open`,
    url: sheetUrl(p.projectId, p.dayKey),
    tag: `ts-sunday:${p.projectId}:${p.dayKey}`,
  });
}

/** The Owner approved or rejected Sunday lines → tell whoever recorded them. */
export async function alertSundayDecided(p: { projectId: string; projectName: string; dayKey: string; approved: boolean; lines: number; recordedBy: string[]; actorId: string }) {
  return notifyPeople(without(p.recordedBy, p.actorId), {
    category: CATEGORY,
    title: `Sunday work ${p.approved ? "approved" : "not approved"} — ${p.projectName}`,
    body: `${p.lines} line${p.lines === 1 ? "" : "s"} for ${dayText(p.dayKey)} ${p.approved ? "will be paid" : "will not be paid — see the sheet"}`,
    url: sheetUrl(p.projectId, p.dayKey),
    tag: `ts-sunday-decided:${p.projectId}:${p.dayKey}`,
  });
}

/** How many past days the daily reminder looks back over. */
export const REMINDER_LOOKBACK_DAYS = 7;

/**
 * The daily reminder: for every project and recent day that has passed with lines recorded but not all approved by the project
 * engineer, tell the engineer, the foreman, the timekeeper, the Owner and the office staff — once a day until it is done.
 */
export async function sendTimesheetReminders(now: Date = new Date()): Promise<{ days: number; alerted: number }> {
  const todayKey = manilaDayKey(now);
  const since = new Date(`${todayKey}T00:00:00.000Z`);
  since.setUTCDate(since.getUTCDate() - REMINDER_LOOKBACK_DAYS);
  const entries = await prisma.timesheetEntry.findMany({
    where: { date: { gte: since, lt: new Date(`${todayKey}T00:00:00.000Z`) } },
    select: { userId: true, projectId: true, date: true, reviewedAt: true, engineerApprovedAt: true },
  });
  // people paid through the office payroll (the engineer himself…) have their own panel; the engineer's approval does not cover them
  const officePeople = new Map((await prisma.user.findMany({ where: { officePayrollFrom: { not: null } }, select: { id: true, officePayrollFrom: true } })).map((u) => [u.id, u]));
  const groups = new Map<string, { projectId: string; dayKey: string; lines: { userId: string; stage: ReturnType<typeof lineStage> }[] }>();
  entries.forEach((e, i) => {
    const dayKey = e.date.toISOString().slice(0, 10);
    const person = officePeople.get(e.userId);
    if (person && isOfficePaidOn(person, dayKey)) return;
    const key = `${e.projectId}|${dayKey}`;
    const g = groups.get(key) ?? { projectId: e.projectId, dayKey, lines: [] };
    g.lines.push({ userId: String(i), stage: lineStage(e) });
    groups.set(key, g);
  });
  const projects = await prisma.project.findMany({ where: { id: { in: [...new Set([...groups.values()].map((g) => g.projectId))] } }, select: { id: true, name: true } });
  const nameOf = new Map(projects.map((p) => [p.id, p.name]));
  let days = 0;
  let alerted = 0;
  for (const g of groups.values()) {
    const progress = sheetProgress(g.lines);
    if (!approvalOverdue(g.dayKey, todayKey, progress)) continue;
    days++;
    const a = await sheetAudience(g.projectId);
    const to = [...a.engineers, ...a.foremen, ...a.timekeepers, ...a.owners, ...a.office];
    alerted += await notifyPeople(to, {
      category: CATEGORY,
      title: `Timekeeper sheet not approved — ${nameOf.get(g.projectId) ?? "project"}, ${dayText(g.dayKey)}`,
      body: `The day has passed: ${overdueText(progress)}. Tap to open`,
      url: sheetUrl(g.projectId, g.dayKey),
      tag: `ts-overdue:${g.projectId}:${g.dayKey}`,
    });
  }
  return { days, alerted };
}
