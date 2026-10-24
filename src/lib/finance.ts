import { prisma } from "@/lib/prisma";
import { warehouseIssueCosts } from "@/lib/warehouse-issue-cost";
import { runNonCorporateTotal, nonCorporateCharge, type PayrollEntry } from "@/lib/payroll";
import { computeWorkItemStatuses, weightedAccomplishment } from "@/lib/progress";
import { CATEGORY_LABELS, NON_PROJECT_CATEGORIES, requisitionAmount } from "@/lib/requisitions";
import { postedExpense, type PettyCashLike } from "@/lib/cash-expense";

/**
 * Project & company cashflow figures (Spec 6.13).
 * Committed cost = issued PO totals + approved-but-not-yet-PO'd requisition
 * estimates + approved/paid payroll (labor) + liquidated petty cash — all post
 * automatically.
 */

/** Liquidated petty cash only — verified receipts are what a project actually spent. */
export const LIQUIDATED_PETTY_CASH = { where: { status: "LIQUIDATED" as const }, select: { status: true, amount: true, spentAmount: true } };

/** Total posted petty cash expense of a project's (or the company's) liquidated requests. */
export function pettyCashCost(rows: PettyCashLike[]): number {
  return Math.round(rows.reduce((s, r) => s + postedExpense(r), 0) * 100) / 100;
}

export interface ProjectFinance {
  id: string;
  name: string;
  clientName: string;
  status: string;
  contractValue: number;
  received: number;
  receivable: number;
  committedCost: number;
  laborCost: number;
  pettyCashCost: number;
  /** what the project took out of the warehouse stock (net of returns) — part of committedCost */
  warehouseMaterialsCost: number;
  /** warehouse issues with no price yet — not in the cost until they are priced */
  warehouseUnpriced: number;
  grossMargin: number;
  marginPct: number;
  retentionHeld: number;
  accomplishmentPct: number;
}

/** Labor cost of a run = employer payout (gross pay of all entries). */
export function runGross(entries: unknown): number {
  return (entries as PayrollEntry[]).reduce((s, e) => s + e.gross, 0);
}

/** A run's cost to the company's operations: its gross minus any driver hours charged to a non-corporate job. */
export function corporateRunGross(entries: unknown): number {
  return runGross(entries) - runNonCorporateTotal(entries);
}

export async function getProjectFinances(): Promise<ProjectFinance[]> {
  const projects = await prisma.project.findMany({
    // Active + completed/turned-over projects — everything except shelved
    // prospects. Callers split by status (see ONGOING_STATUSES/
    // COMPLETED_STATUSES) to report active vs. done separately.
    // Non-corporate jobs are expenses only and never part of company projects, margins or operating figures.
    where: { status: { not: "NOT_ACTIVE" }, isNonCorporate: false },
    include: {
      client: { select: { name: true } },
      payments: true,
      paymentTerms: true,
      requisitions: {
        include: { purchaseOrder: true },
        where: { status: { in: ["APPROVED", "PO_ISSUED", "DELIVERED"] } },
      },
      payrollRuns: { where: { status: { in: ["APPROVED", "PAID"] } } },
      pettyCash: LIQUIDATED_PETTY_CASH,
      // No `take` — the weighted-accomplishment rollup needs each work
      // item's latest entry, which can be further back than just the most
      // recent entry overall.
      progressEntries: { orderBy: { createdAt: "desc" } },
    },
    orderBy: { createdAt: "desc" },
  });

  const issued = await warehouseIssueCosts(projects.map((p) => p.id));
  return projects.map((p) => {
    const contractValue = Number(p.contractValue);
    const received = p.payments.reduce((s, x) => s + Number(x.amount), 0);
    const laborCost = p.payrollRuns.reduce((s, r) => s + runGross(r.entries), 0);
    const pettyCash = pettyCashCost(p.pettyCash);
    const warehouseMaterialsCost = issued.get(p.id)?.cost ?? 0;
    const committedCost =
      laborCost + pettyCash + warehouseMaterialsCost + p.requisitions.reduce((s, r) => s + requisitionAmount(r), 0);
    const retentionHeld = p.paymentTerms
      .filter((t) => t.type === "RETENTION" && t.status !== "PAID")
      .reduce((s, t) => s + Number(t.amount), 0);
    const grossMargin = contractValue - committedCost;
    return {
      id: p.id,
      name: p.name,
      clientName: p.client.name,
      status: p.status,
      contractValue,
      received,
      receivable: Math.max(contractValue - received, 0),
      committedCost,
      laborCost,
      pettyCashCost: pettyCash,
      warehouseMaterialsCost,
      warehouseUnpriced: issued.get(p.id)?.unpriced ?? 0,
      grossMargin,
      marginPct: contractValue > 0 ? (grossMargin / contractValue) * 100 : 0,
      retentionHeld,
      accomplishmentPct: weightedAccomplishment(computeWorkItemStatuses(p.progressEntries)),
    };
  });
}

export interface MonthlyCashflow {
  month: string; // "Jan 2026"
  inflow: number; // client payments received
  outflow: number; // committed cost: PO totals + approved/paid payroll
}

export async function getMonthlyCashflow(months = 6): Promise<MonthlyCashflow[]> {
  const since = new Date();
  since.setMonth(since.getMonth() - (months - 1));
  since.setDate(1);
  since.setHours(0, 0, 0, 0);

  const [payments, pos, payrollRuns, pettyCash] = await Promise.all([
    prisma.payment.findMany({ where: { dateReceived: { gte: since } } }),
    // Cash out for non-corporate jobs is not operations cashflow.
    prisma.purchaseOrder.findMany({
      where: { createdAt: { gte: since }, status: { not: "CANCELLED" }, NOT: { requisition: { project: { isNonCorporate: true } } } },
    }),
    prisma.payrollRun.findMany({
      where: { status: { in: ["APPROVED", "PAID"] }, createdAt: { gte: since }, NOT: { project: { isNonCorporate: true } } },
    }),
    // Petty cash posts on the day its liquidation is verified (project or company overhead, never non-corporate jobs).
    prisma.pettyCashRequest.findMany({
      where: { status: "LIQUIDATED", liquidatedAt: { gte: since }, NOT: { project: { isNonCorporate: true } } },
      select: { status: true, amount: true, spentAmount: true, liquidatedAt: true },
    }),
  ]);

  const fmt = new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    year: "numeric",
  });

  const buckets: MonthlyCashflow[] = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(since);
    d.setMonth(d.getMonth() + i);
    buckets.push({ month: fmt.format(d), inflow: 0, outflow: 0 });
  }
  const idx = (d: Date) => buckets.findIndex((b) => b.month === fmt.format(d));

  for (const p of payments) {
    const i = idx(new Date(p.dateReceived));
    if (i >= 0) buckets[i].inflow += Number(p.amount);
  }
  for (const po of pos) {
    const i = idx(new Date(po.createdAt));
    if (i >= 0) buckets[i].outflow += Number(po.totalCost);
  }
  for (const run of payrollRuns) {
    const i = idx(new Date(run.createdAt));
    if (i >= 0) buckets[i].outflow += corporateRunGross(run.entries);
  }
  for (const pc of pettyCash) {
    const i = idx(new Date(pc.liquidatedAt!));
    if (i >= 0) buckets[i].outflow += postedExpense(pc);
  }
  return buckets;
}

export interface NonProjectExpense {
  category: string;
  label: string;
  count: number;
  total: number;
}

/**
 * Emergency / Office Supply / Warehouse Supply requisition spend, plus
 * liquidated petty cash that wasn't for any project —
 * deliberately kept OUT of getProjectFinances() (that function only ever
 * sees requisitions reachable through a project's own relation, so
 * project-less ones are structurally invisible there already). This is the
 * one place company-wide non-project spend is totaled, separate from any
 * project's contract value, committed cost, or margin.
 */
export async function getNonProjectExpenses(): Promise<{
  byCategory: NonProjectExpense[];
  total: number;
}> {
  const [requisitions, pettyCash] = await Promise.all([
    prisma.requisition.findMany({
      where: { projectId: null, status: { in: ["APPROVED", "PO_ISSUED", "DELIVERED"] } },
      include: { purchaseOrder: { select: { totalCost: true, status: true } } },
    }),
    prisma.pettyCashRequest.findMany({ where: { projectId: null, ...LIQUIDATED_PETTY_CASH.where }, select: LIQUIDATED_PETTY_CASH.select }),
  ]);

  const byCategory: NonProjectExpense[] = NON_PROJECT_CATEGORIES.map(({ value, label }) => {
    const matching = requisitions.filter((r) => (r.category ?? "EMERGENCY") === value);
    return {
      category: value,
      label: CATEGORY_LABELS[value] ?? label,
      count: matching.length,
      total: matching.reduce((s, r) => s + requisitionAmount(r), 0),
    };
  });
  byCategory.push({ category: "PETTY_CASH", label: "Petty cash", count: pettyCash.length, total: pettyCashCost(pettyCash) });

  return { byCategory, total: byCategory.reduce((s, c) => s + c.total, 0) };
}

export interface NonCorporateJobExpense {
  id: string;
  name: string;
  status: string;
  materials: number; // approved requisitions / POs charged to the job, its liquidated petty cash, and what it took out of the warehouse
  warehouseMaterials: number; // the part of materials that came out of the warehouse stock (net of returns)
  warehouseUnpriced: number; // warehouse issues with no price yet — not counted until they are priced
  crewPayroll: number; // approved or paid payroll of the crew assigned to the job
  driverPayroll: number; // drivers' hours charged to the job
  total: number;
}

/**
 * Everything spent on non-corporate jobs — the owner's own properties and work for other organizations: materials
 * from requisitions, the job crew's payroll, and drivers' hours charged to the job. Recorded here on its own and never
 * added to operations expense, project costs or margins.
 */
export async function getNonCorporateExpenses(): Promise<{ jobs: NonCorporateJobExpense[]; total: number }> {
  const [jobs, driverRuns] = await Promise.all([
    prisma.project.findMany({
      where: { isNonCorporate: true },
      include: {
        requisitions: { where: { status: { in: ["APPROVED", "PO_ISSUED", "DELIVERED"] } }, include: { purchaseOrder: true } },
        payrollRuns: { where: { status: { in: ["APPROVED", "PAID"] } }, select: { entries: true } },
        pettyCash: LIQUIDATED_PETTY_CASH,
      },
      orderBy: { name: "asc" },
    }),
    prisma.payrollRun.findMany({ where: { department: "DRIVER", status: { in: ["APPROVED", "PAID"] } }, select: { entries: true } }),
  ]);

  const driverByJob = new Map<string, number>();
  for (const run of driverRuns) {
    for (const e of run.entries as unknown as PayrollEntry[]) {
      if (e.nonCorporate) driverByJob.set(e.nonCorporate.jobId, (driverByJob.get(e.nonCorporate.jobId) ?? 0) + nonCorporateCharge(e));
    }
  }

  const issued = await warehouseIssueCosts(jobs.map((j) => j.id));
  const rows = jobs.map((j) => {
    const warehouseMaterials = issued.get(j.id)?.cost ?? 0;
    const materials = j.requisitions.reduce((s, r) => s + requisitionAmount(r), 0) + pettyCashCost(j.pettyCash) + warehouseMaterials;
    const crewPayroll = j.payrollRuns.reduce((s, r) => s + runGross(r.entries), 0);
    const driverPayroll = Math.round((driverByJob.get(j.id) ?? 0) * 100) / 100;
    return { id: j.id, name: j.name, status: j.status, materials, warehouseMaterials, warehouseUnpriced: issued.get(j.id)?.unpriced ?? 0, crewPayroll, driverPayroll, total: materials + crewPayroll + driverPayroll };
  });
  return { jobs: rows, total: rows.reduce((s, r) => s + r.total, 0) };
}
