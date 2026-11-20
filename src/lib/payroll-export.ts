/**
 * Payroll Excel downloads (owner's request 2026-11-20): one workbook per pay period with every approved run of that period.
 *  - "site": the weekly runs — every project crew plus the Drivers run (Fri 5:01 PM → Fri 5:00 PM);
 *  - "office": the semi-monthly runs of the office (Office, Engineers, Architects).
 * Pure rules shared by the Payroll page, the download route and the tests.
 */
import { manilaDayKey } from "@/lib/time-rules";

export type PayrollFileKind = "site" | "office";
export const isPayrollFileKind = (v: unknown): v is PayrollFileKind => v === "site" || v === "office";

const OFFICE_DEPARTMENTS = new Set(["OFFICE", "ARCHITECT", "ENGINEER"]);

/** Which download a run belongs to: project crews and drivers → site; office, engineers and architects → office. */
export const fileKindOf = (r: { projectId: string | null; department: string | null }): PayrollFileKind =>
  !r.projectId && r.department && OFFICE_DEPARTMENTS.has(r.department) ? "office" : "site";

/** Only runs the Owner approved (or already paid) go into the file. */
export const isFinalRun = (status: string): boolean => status === "APPROVED" || status === "PAID";

/** A pay period's key: its first and last Manila day, e.g. "2026-11-13_2026-11-20". */
export const periodKeyOf = (r: { periodStart: Date; periodEnd: Date }): string => `${manilaDayKey(r.periodStart)}_${manilaDayKey(r.periodEnd)}`;

export interface ExportRunLike {
  id: string;
  projectId: string | null;
  department: string | null;
  status: string;
  periodStart: Date;
  periodEnd: Date;
  name: string; // project name, or "Drivers" / "Office"…
  net: number;
}

export interface PayPeriodOption {
  key: string;
  kind: PayrollFileKind;
  periodStart: Date;
  periodEnd: Date;
  /** approved / paid runs — the ones in the file */
  runs: ExportRunLike[];
  /** runs of the same period still in draft or review — not in the file yet */
  waiting: ExportRunLike[];
  net: number;
}

/** The pay periods that have at least one approved run, newest first, for one kind of file. */
export function payPeriods(runs: ExportRunLike[], kind: PayrollFileKind): PayPeriodOption[] {
  const byKey = new Map<string, PayPeriodOption>();
  for (const r of runs) {
    if (fileKindOf(r) !== kind) continue;
    const key = periodKeyOf(r);
    let p = byKey.get(key);
    if (!p) {
      p = { key, kind, periodStart: r.periodStart, periodEnd: r.periodEnd, runs: [], waiting: [], net: 0 };
      byKey.set(key, p);
    }
    if (isFinalRun(r.status)) {
      p.runs.push(r);
      p.net = Math.round((p.net + r.net) * 100) / 100;
      if (r.periodStart < p.periodStart) p.periodStart = r.periodStart;
      if (r.periodEnd > p.periodEnd) p.periodEnd = r.periodEnd;
    } else if (r.status === "DRAFT" || r.status === "REVIEW") p.waiting.push(r);
  }
  return [...byKey.values()].filter((p) => p.runs.length > 0).sort((a, b) => b.periodEnd.getTime() - a.periodEnd.getTime());
}

/** Sheet order inside a file: projects A–Z, then department runs (Drivers, Office…). */
export function sheetOrder<T extends { projectId: string | null; name: string }>(runs: T[]): T[] {
  return [...runs].sort((a, b) => (a.projectId ? 0 : 1) - (b.projectId ? 0 : 1) || a.name.localeCompare(b.name));
}

/** An Excel sheet name: at most 31 characters, none of : \ / ? * [ ], unique within the workbook. */
export function sheetName(wanted: string, taken: Set<string>): string {
  const base = wanted.replace(/[:\\/?*[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31) || "Sheet";
  let name = base;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base.slice(0, 31 - ` (${n})`.length)} (${n})`;
  taken.add(name.toLowerCase());
  return name;
}

/** Bills and coins for a cash payout, largest first. */
export const DENOMINATIONS = [1000, 500, 200, 100, 50, 20, 10, 5, 1] as const;

/**
 * How to make up a net pay in cash: pieces of each bill/coin (largest first) and the centavos left over. A net of zero or less
 * (cash advance bigger than the pay) needs no cash.
 */
export function cashBreakdown(net: number): { pieces: number[]; centavos: number } {
  let cents = Math.max(0, Math.round(net * 100));
  const pieces = DENOMINATIONS.map((d) => {
    const n = Math.floor(cents / (d * 100));
    cents -= n * d * 100;
    return n;
  });
  return { pieces, centavos: cents / 100 };
}

/** The daily rate shown for an hourly rate: 8 hours, to the peso when the hourly rate was itself rounded (₱78.13 → ₱625). */
export function dailyRateOf(hourlyRate: number): number {
  const d = hourlyRate * 8;
  return Math.abs(d - Math.round(d)) <= 0.1 ? Math.round(d) : Math.round(d * 100) / 100;
}

/** The file name, e.g. "Payroll - Site & Drivers - 2026-11-13 to 2026-11-20.xlsx". */
export function payrollFileName(kind: PayrollFileKind, key: string): string {
  const [a, b] = key.split("_");
  return `Payroll - ${kind === "site" ? "Site & Drivers" : "Office"} - ${a} to ${b}.xlsx`;
}
