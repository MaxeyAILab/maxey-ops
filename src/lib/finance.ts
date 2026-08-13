import { prisma } from "@/lib/prisma";
import type { PayrollEntry } from "@/lib/payroll";
import { computeWorkItemStatuses, weightedAccomplishment } from "@/lib/progress";
import { CATEGORY_LABELS, NON_PROJECT_CATEGORIES, requisitionAmount } from "@/lib/requisitions";

/**
 * Project & company cashflow figures (Spec 6.13).
 * Committed cost = issued PO totals + approved-but-not-yet-PO'd requisition
 * estimates + approved/paid payroll (labor) — all post automatically.
 */

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
  grossMargin: number;
  marginPct: number;
  retentionHeld: number;
  accomplishmentPct: number;
}

/** Labor cost of a run = employer payout (gross pay of all entries). */
export function runGross(entries: unknown): number {
  return (entries as PayrollEntry[]).reduce((s, e) => s + e.gross, 0);
}

export async function getProjectFinances(): Promise<ProjectFinance[]> {
  const projects = await prisma.project.findMany({
    // Active + completed/turned-over projects — everything except shelved
    // prospects. Callers split by status (see ONGOING_STATUSES/
    // COMPLETED_STATUSES) to report active vs. done separately.
    where: { status: { not: "NOT_ACTIVE" } },
    include: {
      client: { select: { name: true } },
      payments: true,
      paymentTerms: true,
      requisitions: {
        include: { purchaseOrder: true },
        where: { status: { in: ["APPROVED", "PO_ISSUED", "DELIVERED"] } },
      },
      payrollRuns: { where: { status: { in: ["APPROVED", "PAID"] } } },
      // No `take` — the weighted-accomplishment rollup needs each work
      // item's latest entry, which can be further back than just the most
      // recent entry overall.
      progressEntries: { orderBy: { createdAt: "desc" } },
    },
    orderBy: { createdAt: "desc" },
  });

  return projects.map((p) => {
    const contractValue = Number(p.contractValue);
    const received = p.payments.reduce((s, x) => s + Number(x.amount), 0);
    const laborCost = p.payrollRuns.reduce((s, r) => s + runGross(r.entries), 0);
    const committedCost =
      laborCost + p.requisitions.reduce((s, r) => s + requisitionAmount(r), 0);
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

  const [payments, pos, payrollRuns] = await Promise.all([
    prisma.payment.findMany({ where: { dateReceived: { gte: since } } }),
    prisma.purchaseOrder.findMany({ where: { createdAt: { gte: since }, status: { not: "CANCELLED" } } }),
    prisma.payrollRun.findMany({
      where: { status: { in: ["APPROVED", "PAID"] }, createdAt: { gte: since } },
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
    if (i >= 0) buckets[i].outflow += runGross(run.entries);
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
 * Emergency / Office Supply / Warehouse Supply requisition spend —
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
  const requisitions = await prisma.requisition.findMany({
    where: { projectId: null, status: { in: ["APPROVED", "PO_ISSUED", "DELIVERED"] } },
    include: { purchaseOrder: { select: { totalCost: true, status: true } } },
  });

  const byCategory = NON_PROJECT_CATEGORIES.map(({ value, label }) => {
    const matching = requisitions.filter((r) => (r.category ?? "EMERGENCY") === value);
    return {
      category: value,
      label: CATEGORY_LABELS[value] ?? label,
      count: matching.length,
      total: matching.reduce((s, r) => s + requisitionAmount(r), 0),
    };
  });

  return { byCategory, total: byCategory.reduce((s, c) => s + c.total, 0) };
}
