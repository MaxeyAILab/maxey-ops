import { prisma } from "@/lib/prisma";
import type { Attendance, Department } from "@prisma/client";
import {
  computeEffectiveHours,
  manilaDayKey,
  rulesetForDepartment,
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

const dayKeyFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Manila",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Hours per Manila calendar day → regular/OT split → gross/deductions/net.
 * Each record's raw span is first passed through computeEffectiveHours() —
 * the scheduled-start clamp, lunch/break deductions, and 5pm cutoff — before
 * being summed into its day's bucket. */
function buildEntry(
  user: { id: string; name: string },
  records: Attendance[],
  hourlyRate: number,
  ruleset: TimeRuleset,
  approvalsByAttendanceId: Map<string, AdjustmentFlags>
): PayrollEntry | null {
  if (records.length === 0) return null;

  const byDay = new Map<string, number>();
  for (const a of records) {
    const key = dayKeyFmt.format(a.timeIn);
    const flags = approvalsByAttendanceId.get(a.id);
    const hours = computeEffectiveHours(a.timeIn, a.timeOut!, ruleset, flags);
    byDay.set(key, (byDay.get(key) ?? 0) + hours);
  }

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
  const approvals = await fetchApprovals(attendance);

  const entries: PayrollEntry[] = [];
  for (const a of assignments) {
    const records = attendance.filter(
      (rec) => rec.userId === a.userId && rec.timeIn >= a.startDate
    );
    const entry = buildEntry(a.user, records, Number(a.hourlyRate), "SITE", approvals);
    if (entry) entries.push(entry);
  }
  return entries;
}

/**
 * Department payroll (Office staff / Drivers — no project). Rates come from
 * the user's profile (hourlyRate, or dailyRate / 8). Drivers follow the SITE
 * schedule; Office/Architect/Engineer follow the OFFICE schedule.
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
  const approvals = await fetchApprovals(attendance);

  const entries: PayrollEntry[] = [];
  for (const u of users) {
    const hourlyRate =
      u.hourlyRate != null
        ? Number(u.hourlyRate)
        : u.dailyRate != null
          ? Number(u.dailyRate) / PAYROLL_CONFIG.regularHoursPerDay
          : 0;
    const entry = buildEntry(
      u,
      attendance.filter((a) => a.userId === u.id),
      hourlyRate,
      ruleset,
      approvals
    );
    if (entry) entries.push(entry);
  }
  return entries;
}
