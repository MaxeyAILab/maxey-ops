import { prisma } from "@/lib/prisma";
import type { Attendance, Department } from "@prisma/client";

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
  net: number;
}

const dayKeyFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Manila",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Hours per Manila calendar day → regular/OT split → gross/deductions/net. */
function buildEntry(
  user: { id: string; name: string },
  records: Attendance[],
  hourlyRate: number
): PayrollEntry | null {
  if (records.length === 0) return null;

  const byDay = new Map<string, number>();
  for (const a of records) {
    const key = dayKeyFmt.format(a.timeIn);
    const hours = (a.timeOut!.getTime() - a.timeIn.getTime()) / 3_600_000;
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
  const net = Math.max(0, gross - sss - philhealth - pagibig);

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
    net: r2(net),
  };
}

/**
 * Per-project payroll: employees come from the project's roster
 * (ProjectAssignment), rates come from the assignment, and only attendance
 * clocked against this project — on or after each employee's project start
 * date — is counted.
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

  const entries: PayrollEntry[] = [];
  for (const a of assignments) {
    const records = attendance.filter(
      (rec) => rec.userId === a.userId && rec.timeIn >= a.startDate
    );
    const entry = buildEntry(a.user, records, Number(a.hourlyRate));
    if (entry) entries.push(entry);
  }
  return entries;
}

/**
 * Department payroll (Office staff / Drivers — no project). Rates come from
 * the user's profile (hourlyRate, or dailyRate / 8).
 */
export async function computePayroll(
  department: Department,
  periodStart: Date,
  periodEnd: Date
): Promise<PayrollEntry[]> {
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
      hourlyRate
    );
    if (entry) entries.push(entry);
  }
  return entries;
}
