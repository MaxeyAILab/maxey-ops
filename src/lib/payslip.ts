import { PAYROLL_CONFIG, type PayrollEntry } from "@/lib/payroll";
import { manilaDayKey } from "@/lib/time-rules";

/**
 * What goes on a payslip, worked out from a payroll run's saved entry — pure, so the numbers and wording can be
 * tested without a database or a PDF. The payslip never recalculates pay: it only shows what the (possibly
 * Owner-edited) register says, so it can never disagree with the approved payroll.
 */

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface SlipRunInfo {
  periodStart: Date;
  periodEnd: Date;
  projectName: string | null;
  approvedByName: string | null;
}

export interface SlipEmployeeInfo {
  employeeNo: string | null;
  position: string | null;
  department: string | null;
}

export interface PayslipModel {
  name: string;
  periodLabel: string; // "Sept. 16-30, 2026"
  dateLabel: string; // "30-Sep-26" — the last day of the period
  employeeNo: string; // "" when none has been set yet
  designation: string;
  projectName: string | null;
  earnings: {
    regularHours: number;
    daysWorked: number;
    hourlyRate: number;
    otHours: number;
    otPay: number;
    total: number; // the whole gross, regular + overtime
  };
  totalEarnings: number;
  deductions: { label: string; amount: number; showWhenZero: boolean }[];
  totalDeductions: number;
  netPay: number;
  approvedBy: string;
  reference: string; // "2026-009"; "" when not assigned
}

// The paper form's spelling of months in the period line ("Sept. 16-30, 2026").
const MONTH_LONG = ["Jan.", "Feb.", "Mar.", "Apr.", "May", "June", "July", "Aug.", "Sept.", "Oct.", "Nov.", "Dec."];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parts(day: Date) {
  const [y, m, d] = manilaDayKey(day).split("-").map(Number);
  return { y, m: m - 1, d };
}

/** "Sept. 16-30, 2026", "Sept. 28 - Oct. 4, 2026" or "Dec. 28, 2026 - Jan. 3, 2027" — by Manila calendar day. */
export function payslipPeriodLabel(start: Date, end: Date): string {
  const a = parts(start);
  const b = parts(end);
  if (a.y === b.y && a.m === b.m) return `${MONTH_LONG[a.m]} ${a.d}-${b.d}, ${a.y}`;
  if (a.y === b.y) return `${MONTH_LONG[a.m]} ${a.d} - ${MONTH_LONG[b.m]} ${b.d}, ${a.y}`;
  return `${MONTH_LONG[a.m]} ${a.d}, ${a.y} - ${MONTH_LONG[b.m]} ${b.d}, ${b.y}`;
}

/** "30-Sep-26". */
export function payslipDateLabel(day: Date): string {
  const p = parts(day);
  return `${String(p.d).padStart(2, "0")}-${MONTH_SHORT[p.m]}-${String(p.y % 100).padStart(2, "0")}`;
}

const DEPARTMENT_LABEL: Record<string, string> = {
  OFFICE: "Office Staff",
  DRIVER: "Driver",
  SITE: "Site Personnel",
  ARCHITECT: "Architect",
  ENGINEER: "Engineer",
};

export function buildPayslip(entry: PayrollEntry & { slipRef?: string }, employee: SlipEmployeeInfo, run: SlipRunInfo): PayslipModel {
  const otPay = r2(entry.otHours * entry.hourlyRate * PAYROLL_CONFIG.otMultiplier);
  const deductions: PayslipModel["deductions"] = [
    { label: "SSS", amount: entry.sss, showWhenZero: true },
    { label: "PHILHEALTH", amount: entry.philhealth, showWhenZero: true },
    { label: "PAG-IBIG", amount: entry.pagibig, showWhenZero: true },
    // The form's "others" line: the two extra deductions the Owner can set on the register.
    { label: "Meals", amount: entry.meals ?? 0, showWhenZero: false },
    { label: "Cash advance", amount: entry.cashAdvance ?? 0, showWhenZero: false },
  ];
  return {
    name: entry.name,
    periodLabel: payslipPeriodLabel(run.periodStart, run.periodEnd),
    dateLabel: payslipDateLabel(run.periodEnd),
    employeeNo: employee.employeeNo ?? "",
    designation: employee.position?.trim() || (employee.department ? DEPARTMENT_LABEL[employee.department] ?? "" : ""),
    projectName: run.projectName,
    earnings: {
      regularHours: entry.regularHours,
      daysWorked: entry.daysWorked,
      hourlyRate: entry.hourlyRate,
      otHours: entry.otHours,
      otPay,
      total: entry.gross,
    },
    totalEarnings: entry.gross,
    deductions,
    totalDeductions: r2(deductions.reduce((s, d) => s + d.amount, 0)),
    netPay: entry.net,
    approvedBy: run.approvedByName ?? "",
    reference: entry.slipRef ?? "",
  };
}

/**
 * The next payslip reference numbers for a year: "2026-001", "2026-002"… continuing after the highest one already
 * issued that year, so a number is never reused and a reprint always carries the same number.
 */
export function nextSlipRefs(existing: (string | undefined | null)[], year: number, count: number): string[] {
  let max = 0;
  const prefix = `${year}-`;
  for (const ref of existing) {
    if (!ref || !ref.startsWith(prefix)) continue;
    const n = Number(ref.slice(prefix.length));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return Array.from({ length: count }, (_, i) => `${year}-${String(max + i + 1).padStart(3, "0")}`);
}

/** Year the reference numbers run in — the year the pay period ends, as on the paper form. */
export const slipYear = (periodEnd: Date) => parts(periodEnd).y;

/** Money as the paper form prints it: 13,000.00 */
export function slipMoney(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function slipFileName(label: string, periodEnd: Date, single: boolean): string {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "payslip";
  return `payslip${single ? "" : "s"}-${slug}-${manilaDayKey(periodEnd)}.pdf`;
}
