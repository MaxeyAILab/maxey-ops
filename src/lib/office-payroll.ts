import type { Prisma } from "@prisma/client";
import { ApiError } from "@/lib/rbac";

/**
 * "Paid through the office payroll" (User.officePayrollFrom): a person who works on a project — such as the project engineer — but is
 * paid by the office semi-monthly payroll (1st–15th and 16th–end of the month), not the project's weekly crew payroll. From the
 * date set, their time is left out of every project payroll run and counted in the office run instead, and on the timekeeper sheet
 * they are kept on a panel of their own. Days before that date stay exactly where they were paid. Pure rules first, then the database
 * step the Owner's switch uses.
 */

/** Departments that are paid semi-monthly by the office run — the only ones that can be moved to it. */
export const OFFICE_PAID_DEPARTMENTS = ["OFFICE", "ARCHITECT", "ENGINEER"];

export interface OfficePaidPerson {
  officePayrollFrom?: Date | string | null;
}

const keyOf = (d: Date | string): string => (typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10));

/** Whether this person's time on the Manila calendar day `dayKey` ("2026-11-09") is paid by the office payroll. */
export function isOfficePaidOn(p: OfficePaidPerson, dayKey: string): boolean {
  return !!p.officePayrollFrom && dayKey >= keyOf(p.officePayrollFrom);
}

/** The Manila calendar day a person's office payroll starts on, or null. */
export const officePayrollFromKey = (p: OfficePaidPerson): string | null => (p.officePayrollFrom ? keyOf(p.officePayrollFrom) : null);

/** The semi-monthly period a day belongs to: "1st–15th" or "16th–end" of its month, as day keys. */
export function semiMonthlyRange(dayKey: string): { start: string; end: string; label: string } {
  const [y, m, d] = dayKey.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  const month = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  return d <= 15
    ? { start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-15`, label: `1st–15th of ${month}` }
    : { start: `${y}-${pad(m)}-16`, end: `${y}-${pad(m)}-${pad(last)}`, label: `16th–${last}th of ${month}` };
}

type Db = Prisma.TransactionClient;

interface RunEntry {
  userId: string;
  regularHours?: number;
  otHours?: number;
}
const hoursOf = (entries: unknown, userId: string): number => {
  const e = (Array.isArray(entries) ? (entries as RunEntry[]) : []).find((x) => x.userId === userId);
  return e ? (e.regularHours ?? 0) + (e.otHours ?? 0) : 0;
};

export interface OfficePayrollChange {
  from: string | null;
  /** draft / review project runs the person was taken out of */
  removedFromRuns: { runId: string; project: string; period: string }[];
}

/**
 * Moves a person to the office payroll from `from` (a Manila day), or back to the project payroll (`from` = null). Refuses when it would
 * pay the same days twice or leave them unpaid:
 *  - to the office payroll: an approved/paid project run that already paid them hours on or after that day;
 *  - back to the project payroll: an approved/paid office run that already paid them hours on or after the day it started.
 * Moving to the office payroll also takes the person's line out of any DRAFT / REVIEW project run that covers days from then on
 * (those runs are still being worked on; the audit log keeps what was removed). Call inside a transaction.
 */
export async function setOfficePayroll(db: Db, p: { userId: string; from: string | null }): Promise<OfficePayrollChange> {
  const user = await db.user.findUnique({ where: { id: p.userId }, select: { id: true, name: true, department: true, role: true, officePayrollFrom: true, active: true } });
  if (!user) throw new ApiError(404, "Person not found");
  if (user.role === "CLIENT") throw new ApiError(400, "A client account has no payroll");

  const currentFrom = officePayrollFromKey(user);
  if (p.from === null) {
    if (!currentFrom) return { from: null, removedFromRuns: [] };
    const paid = await db.payrollRun.findMany({ where: { department: { in: OFFICE_PAID_DEPARTMENTS as never }, status: { in: ["APPROVED", "PAID"] }, periodEnd: { gte: new Date(`${currentFrom}T00:00:00.000Z`) } }, select: { entries: true, periodStart: true } });
    if (paid.some((r) => hoursOf(r.entries, user.id) > 0)) {
      throw new ApiError(409, `${user.name} was already paid through an approved office payroll since ${currentFrom} — moving them back to the project payroll would pay those days twice`);
    }
    await db.user.update({ where: { id: user.id }, data: { officePayrollFrom: null } });
    return { from: null, removedFromRuns: [] };
  }

  const parsed = new Date(`${p.from}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.from) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== p.from) throw new ApiError(400, "That is not a valid date");
  if (!user.department || !OFFICE_PAID_DEPARTMENTS.includes(user.department)) {
    throw new ApiError(400, `${user.name} is in the ${user.department ?? "no"} department — only office, architect and engineer staff are paid by the semi-monthly office payroll. Change their department first (Attendance → Edit).`);
  }
  const fromDate = new Date(`${p.from}T00:00:00.000Z`);
  const projectRuns = await db.payrollRun.findMany({
    where: { projectId: { not: null }, periodEnd: { gte: fromDate } },
    select: { id: true, status: true, entries: true, periodStart: true, periodEnd: true, project: { select: { name: true } } },
  });
  const paidTwice = projectRuns.find((r) => ["APPROVED", "PAID"].includes(r.status) && hoursOf(r.entries, user.id) > 0);
  if (paidTwice) {
    const end = paidTwice.periodEnd.toISOString().slice(0, 10);
    throw new ApiError(409, `${user.name} was already paid hours in an approved project payroll (${paidTwice.project?.name}, up to ${end}) — start the office payroll after those days, or cancel that approval first`);
  }

  await db.user.update({ where: { id: user.id }, data: { officePayrollFrom: fromDate } });

  // still-open project runs: take the person's line out
  const removedFromRuns: OfficePayrollChange["removedFromRuns"] = [];
  for (const r of projectRuns) {
    if (!["DRAFT", "REVIEW"].includes(r.status)) continue;
    const entries = Array.isArray(r.entries) ? (r.entries as unknown as RunEntry[]) : [];
    if (!entries.some((e) => e.userId === user.id)) continue;
    await db.payrollRun.update({ where: { id: r.id }, data: { entries: entries.filter((e) => e.userId !== user.id) as never } });
    removedFromRuns.push({ runId: r.id, project: r.project?.name ?? "project", period: `${r.periodStart.toISOString().slice(0, 10)} – ${r.periodEnd.toISOString().slice(0, 10)}` });
  }
  return { from: p.from, removedFromRuns };
}
