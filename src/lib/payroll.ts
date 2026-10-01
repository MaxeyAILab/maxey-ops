import { prisma } from "@/lib/prisma";
import type { Attendance, Department } from "@prisma/client";
import {
  computeEffectiveHours,
  manilaDayKey,
  rulesetForDepartment,
  workingDaysInManilaMonth,
  type AdjustmentFlags,
  type TimeRuleset,
} from "@/lib/time-rules";

/**
 * Payroll computation (Spec 6.5). PH labor-rule parameters are collected here
 * so they can be tuned in one place (a settings UI can replace them later).
 * Statutory deductions are PLACEHOLDERS for internal payout math — full
 * BIR/SSS/PhilHealth/Pag-IBIG remittance filing is out of scope (Spec §9.2).
 */
export const PAYROLL_CONFIG = {
  regularHoursPerDay: 8,
  otMultiplier: 1.25, // ordinary-day overtime premium
  sssRate: 0.045, // employee share, placeholder
  philhealthRate: 0.025, // employee share, placeholder
  pagibigFlat: 100, // monthly flat, applied per run as placeholder
};

export interface PayrollEntry {
  userId: string;
  name: string;
  daysWorked: number;
  regularHours: number;
  otHours: number;
  hourlyRate: number;
  gross: number;
  sss: number;
  philhealth: number;
  pagibig: number;
  meals: number; // ad-hoc deduction, editable by Owner/PM before approval — 0 at generation
  cashAdvance: number; // ditto
  net: number;
}

/** meals/cashAdvance postdate some existing PayrollRun.entries JSON blobs —
 * default them to 0 so an older run doesn't render/sum as NaN. */
export function normalizeEntries(entries: PayrollEntry[]): PayrollEntry[] {
  return entries.map((e) => ({ ...e, meals: e.meals ?? 0, cashAdvance: e.cashAdvance ?? 0 }));
}

/**
 * One user's hours, bucketed by Manila calendar day — the single shared
 * "what counts as a day's hours" computation behind the attendance summary,
 * the yearly log, and payroll's regular/OT split. An Owner override wins
 * outright for that day; otherwise each record's computeEffectiveHours() is
 * summed and the day is capped at exactly 8 hours unless it has an approved
 * overtime/weekend-work request — so the same employee's same day can never
 * show two different numbers in two different parts of the app.
 */
export function computeDailyHoursByDay(
  userId: string,
  records: Attendance[],
  ruleset: TimeRuleset,
  approvals: Map<string, AdjustmentFlags>,
  overrides: Map<string, number>
): Map<string, number> {
  const byDay = new Map<string, number>();
  const approvedDays = new Set<string>();
  for (const r of records) {
    if (!r.timeOut) continue;
    const key = manilaDayKey(r.timeIn);
    const flags = approvals.get(r.id);
    if (flags?.overtimeApproved || flags?.weekendApproved) approvedDays.add(key);
    const hours = computeEffectiveHours(r.timeIn, r.timeOut, ruleset, flags);
    byDay.set(key, (byDay.get(key) ?? 0) + hours);
  }
  for (const [key, hours] of byDay) {
    const override = overrides.get(`${userId}|${key}`);
    if (override != null) {
      byDay.set(key, override);
      approvedDays.add(key); // an override is itself the approval — never re-capped
    } else if (!approvedDays.has(key)) {
      byDay.set(key, Math.min(8, hours));
    }
  }
  return byDay;
}

/** Regular/OT split → gross/deductions/net, from computeDailyHoursByDay()'s
 * per-day totals — the same day-bucketed, capped-unless-approved, override-
 * aware numbers the attendance summary and yearly log show, so payroll can
 * never price a day differently than it's displayed elsewhere. A day's value
 * is ≤8 unless it carries an approved overtime/weekend-work request (or an
 * Owner override), which is exactly when it's correct for the excess to
 * price as OT below — an unapproved double clock-in stacking past 8 hours
 * gets capped, not paid at the 1.25× premium. */
function buildEntry(
  user: { id: string; name: string },
  records: Attendance[],
  hourlyRate: number,
  ruleset: TimeRuleset,
  approvalsByAttendanceId: Map<string, AdjustmentFlags>,
  overridesByUserDay: Map<string, number>
): PayrollEntry | null {
  if (records.length === 0) return null;

  const byDay = computeDailyHoursByDay(user.id, records, ruleset, approvalsByAttendanceId, overridesByUserDay);

  const cfg = PAYROLL_CONFIG;
  let regularHours = 0;
  let otHours = 0;
  for (const hours of byDay.values()) {
    regularHours += Math.min(cfg.regularHoursPerDay, hours);
    otHours += Math.max(0, hours - cfg.regularHoursPerDay);
  }

  const gross = regularHours * hourlyRate + otHours * hourlyRate * cfg.otMultiplier;
  const sss = gross * cfg.sssRate;
  const philhealth = gross * cfg.philhealthRate;
  const pagibig = gross > 0 ? cfg.pagibigFlat : 0;
  const meals = 0;
  const cashAdvance = 0;
  const net = Math.max(0, gross - sss - philhealth - pagibig - meals - cashAdvance);

  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    userId: user.id,
    name: user.name,
    daysWorked: byDay.size,
    regularHours: r2(regularHours),
    otHours: r2(otHours),
    hourlyRate: r2(hourlyRate),
    gross: r2(gross),
    sss: r2(sss),
    philhealth: r2(philhealth),
    pagibig: r2(pagibig),
    meals: r2(meals),
    cashAdvance: r2(cashAdvance),
    net: r2(net),
  };
}

/** Approved early-start/overtime/weekend-work requests relevant to a batch of
 * attendance rows, keyed by attendanceId — the only way
 * computeEffectiveHours() ever lifts a clamp. Pending/rejected requests are
 * treated the same as no request. WEEKEND_WORK requests aren't tied to a
 * specific attendanceId (they're filed before the shift exists), so they're
 * matched here by userId + the shift's own Manila calendar day. */
export async function fetchApprovals(records: Attendance[]): Promise<Map<string, AdjustmentFlags>> {
  if (records.length === 0) return new Map();
  const attendanceIds = records.map((r) => r.id);
  const userIds = Array.from(new Set(records.map((r) => r.userId)));

  const [perShift, weekend] = await Promise.all([
    prisma.timeAdjustmentRequest.findMany({
      where: { attendanceId: { in: attendanceIds }, status: "APPROVED" },
    }),
    prisma.timeAdjustmentRequest.findMany({
      where: { userId: { in: userIds }, type: "WEEKEND_WORK", status: "APPROVED" },
    }),
  ]);

  const weekendApprovedKeys = new Set(
    weekend.filter((w) => w.date).map((w) => `${w.userId}|${manilaDayKey(w.date!)}`)
  );

  const map = new Map<string, AdjustmentFlags>();
  for (const r of records) {
    map.set(r.id, {
      earlyStartApproved: false,
      overtimeApproved: false,
      weekendApproved: weekendApprovedKeys.has(`${r.userId}|${manilaDayKey(r.timeIn)}`),
    });
  }
  for (const r of perShift) {
    if (!r.attendanceId) continue;
    const flags = map.get(r.attendanceId);
    if (!flags) continue;
    if (r.type === "EARLY_START") flags.earlyStartApproved = true;
    if (r.type === "OVERTIME") flags.overtimeApproved = true;
  }
  return map;
}

/** Owner-set manual hour corrections (DailyHoursOverride) for a batch of
 * users across a period, keyed by `${userId}|${manilaDayKey}`. */
export async function fetchDailyOverrides(
  userIds: string[],
  periodStart: Date,
  periodEnd: Date
): Promise<Map<string, number>> {
  if (userIds.length === 0) return new Map();
  const rows = await prisma.dailyHoursOverride.findMany({
    where: { userId: { in: userIds }, date: { gte: periodStart, lte: periodEnd } },
  });
  return new Map(rows.map((r) => [`${r.userId}|${manilaDayKey(r.date)}`, Number(r.hours)]));
}

/**
 * Per-project payroll: employees come from the project's roster
 * (ProjectAssignment), rates come from the assignment, and only attendance
 * clocked against this project — on or after each employee's project start
 * date — is counted. Project crew always follow the SITE schedule (7:30 AM
 * start, morning/afternoon breaks) regardless of the worker's department.
 */
export async function computeProjectPayroll(
  projectId: string,
  periodStart: Date,
  periodEnd: Date
): Promise<PayrollEntry[]> {
  const assignments = await prisma.projectAssignment.findMany({
    where: { projectId, active: true },
    include: { user: { select: { id: true, name: true } } },
    orderBy: { user: { name: "asc" } },
  });

  const attendance = await prisma.attendance.findMany({
    where: {
      projectId,
      userId: { in: assignments.map((a) => a.userId) },
      timeIn: { gte: periodStart, lte: periodEnd },
      timeOut: { not: null },
    },
  });
  const [approvals, overrides] = await Promise.all([
    fetchApprovals(attendance),
    fetchDailyOverrides(assignments.map((a) => a.userId), periodStart, periodEnd),
  ]);

  const entries: PayrollEntry[] = [];
  for (const a of assignments) {
    const records = attendance.filter(
      (rec) => rec.userId === a.userId && rec.timeIn >= a.startDate
    );
    const entry = buildEntry(a.user, records, Number(a.hourlyRate), "SITE", approvals, overrides);
    if (entry) entries.push(entry);
  }
  return entries;
}

/**
 * Department payroll (Office/Architect/Engineer, paid semi-monthly; Drivers,
 * paid weekly — no project). Drivers follow the SITE schedule and their
 * profile hourlyRate/dailyRate. Office/Architect/Engineer follow the OFFICE
 * schedule, and when `monthlySalary` is set on the profile, their effective
 * hourly rate is (monthlySalary / that period's working days in the month)
 * / 8 — otherwise the existing hourlyRate/dailyRate fallback applies.
 */
export async function computePayroll(
  department: Department,
  periodStart: Date,
  periodEnd: Date
): Promise<PayrollEntry[]> {
  const ruleset = rulesetForDepartment(department);
  const users = await prisma.user.findMany({
    where: { department, active: true, role: { not: "CLIENT" } },
    orderBy: { name: "asc" },
  });

  const attendance = await prisma.attendance.findMany({
    where: {
      userId: { in: users.map((u) => u.id) },
      timeIn: { gte: periodStart, lte: periodEnd },
      timeOut: { not: null },
    },
  });
  const [approvals, overrides] = await Promise.all([
    fetchApprovals(attendance),
    fetchDailyOverrides(users.map((u) => u.id), periodStart, periodEnd),
  ]);

  // A semi-monthly period never spans two calendar months, so periodStart's
  // Manila month is the one whose Mon–Sat day count divides the salary.
  const monthKey = manilaDayKey(periodStart).slice(0, 7);
  const workingDays = workingDaysInManilaMonth(monthKey);

  const entries: PayrollEntry[] = [];
  for (const u of users) {
    const hourlyRate =
      u.monthlySalary != null
        ? Number(u.monthlySalary) / workingDays / PAYROLL_CONFIG.regularHoursPerDay
        : u.hourlyRate != null
          ? Number(u.hourlyRate)
          : u.dailyRate != null
            ? Number(u.dailyRate) / PAYROLL_CONFIG.regularHoursPerDay
            : 0;
    const entry = buildEntry(
      u,
      attendance.filter((a) => a.userId === u.id),
      hourlyRate,
      ruleset,
      approvals,
      overrides
    );
    if (entry) entries.push(entry);
  }
  return entries;
}
