import { prisma } from "@/lib/prisma";
import { getMonthlyCashflow, getNonProjectExpenses, getProjectFinances, type ProjectFinance } from "@/lib/finance";
import { COMPLETED_STATUSES, ONGOING_STATUSES } from "@/lib/project-status";

/**
 * Everything the Finance tab needs, computed from real rows only — no
 * fabricated figures. Where the schema genuinely can't answer a question
 * (there's no bank feed, no scheduled future payment dates, no cost-category
 * split on requisitions), the function says so instead of inventing a number:
 * either it's a manually-entered snapshot (cash on hand), a straight-line
 * projection off a trailing average clearly labeled as such (cash/backlog
 * runway), or the panel returns enough info for the page to render an honest
 * empty state.
 */

// ---------- Cash on hand (manual bank check — no bank integration exists) ----------

export interface CashSnapshotView {
  amount: number;
  note: string | null;
  recordedByName: string;
  recordedAt: Date;
}

export async function getLatestCashSnapshot(): Promise<CashSnapshotView | null> {
  const snap = await prisma.cashSnapshot.findFirst({
    orderBy: { recordedAt: "desc" },
    include: { recordedBy: { select: { name: true } } },
  });
  if (!snap) return null;
  return {
    amount: Number(snap.amount),
    note: snap.note,
    recordedByName: snap.recordedBy.name,
    recordedAt: snap.recordedAt,
  };
}

// ---------- WIP (work-in-progress) — earned vs. billed per active project ----------

export interface WipRow {
  id: string;
  name: string;
  clientName: string;
  status: string;
  isCompleted: boolean;
  contractValue: number;
  costToDate: number;
  pctComplete: number;
  earned: number;
  billed: number;
  /** Forecast margin at completion: extrapolates cost-to-date at the current
   * cost-per-%-complete burn rate across the whole contract — not just
   * "margin on cost spent so far." For an already-completed project this
   * collapses to the actual final margin, since accomplishmentPct is ~100. */
  marginAtCompletionPct: number;
  targetMarginPct: number | null;
  billingGap: number; // billed − earned: positive = client has paid ahead, negative = you're funding the work
}

export function marginAtCompletion(f: ProjectFinance): number {
  if (f.contractValue <= 0) return 0;
  const projectedTotalCost =
    f.accomplishmentPct > 0 ? f.committedCost / (f.accomplishmentPct / 100) : f.committedCost;
  return ((f.contractValue - projectedTotalCost) / f.contractValue) * 100;
}

/** Ongoing projects (true work-in-progress) plus completed/turned-over ones
 * — so the tab still has something to show once a project wraps, matching
 * what the Owner Dashboard already surfaces for finished work. Ongoing rows
 * sort first. */
export async function getWipTable(): Promise<{ rows: WipRow[]; totals: WipRow | null }> {
  const [finances, targets] = await Promise.all([
    getProjectFinances(),
    prisma.project.findMany({ select: { id: true, targetMarginPct: true } }),
  ]);
  const targetById = new Map(targets.map((t) => [t.id, t.targetMarginPct != null ? Number(t.targetMarginPct) : null]));

  const included = finances
    .filter(
      (f) => (ONGOING_STATUSES as string[]).includes(f.status) || (COMPLETED_STATUSES as string[]).includes(f.status)
    )
    .sort((a, b) => {
      const aDone = (COMPLETED_STATUSES as string[]).includes(a.status) ? 1 : 0;
      const bDone = (COMPLETED_STATUSES as string[]).includes(b.status) ? 1 : 0;
      return aDone - bDone;
    });
  const rows: WipRow[] = included.map((f) => {
    const earned = (f.contractValue * f.accomplishmentPct) / 100;
    const isCompleted = (COMPLETED_STATUSES as string[]).includes(f.status);
    return {
      id: f.id,
      name: f.name,
      clientName: f.clientName,
      status: f.status,
      isCompleted,
      contractValue: f.contractValue,
      costToDate: f.committedCost,
      pctComplete: f.accomplishmentPct,
      earned,
      billed: f.received,
      marginAtCompletionPct: marginAtCompletion(f),
      targetMarginPct: targetById.get(f.id) ?? null,
      billingGap: f.received - earned,
    };
  });

  if (rows.length === 0) return { rows, totals: null };

  const contractValue = rows.reduce((s, r) => s + r.contractValue, 0);
  const costToDate = rows.reduce((s, r) => s + r.costToDate, 0);
  const earned = rows.reduce((s, r) => s + r.earned, 0);
  const billed = rows.reduce((s, r) => s + r.billed, 0);
  const activeCount = rows.filter((r) => !r.isCompleted).length;
  const doneCount = rows.length - activeCount;
  const totals: WipRow = {
    id: "TOTAL",
    name: `${rows.length} project${rows.length === 1 ? "" : "s"} (${activeCount} active, ${doneCount} completed)`,
    clientName: "",
    status: "",
    isCompleted: false,
    contractValue,
    costToDate,
    pctComplete: contractValue > 0 ? (earned / contractValue) * 100 : 0,
    earned,
    billed,
    marginAtCompletionPct: earned > 0 ? ((earned - costToDate) / earned) * 100 : 0,
    targetMarginPct: null,
    billingGap: billed - earned,
  };
  return { rows, totals };
}

// ---------- Waterfall: earned revenue → net profit, using only real cost rows ----------

export interface Waterfall {
  earnedRevenue: number;
  materials: number; // requisition/PO cost, i.e. committed cost minus labor
  labor: number;
  grossProfit: number;
  overhead: number; // non-project spend (emergency/office/warehouse supply)
  netProfit: number;
}

export async function getWaterfall(): Promise<Waterfall> {
  const [finances, nonProject] = await Promise.all([getProjectFinances(), getNonProjectExpenses()]);
  const earnedRevenue = finances.reduce((s, f) => s + (f.contractValue * f.accomplishmentPct) / 100, 0);
  const labor = finances.reduce((s, f) => s + f.laborCost, 0);
  const materials = finances.reduce((s, f) => s + (f.committedCost - f.laborCost), 0);
  const grossProfit = earnedRevenue - materials - labor;
  const overhead = nonProject.total;
  const netProfit = grossProfit - overhead;
  return { earnedRevenue, materials, labor, grossProfit, overhead, netProfit };
}

// ---------- Backlog & runway (straight-line, off trailing collections pace) ----------

export interface Backlog {
  totalContract: number;
  earnedToDate: number;
  backlogRemaining: number;
  /** Trailing 3-month average of payments received — used as an honest,
   * labeled proxy for revenue pace since earned-value isn't snapshotted
   * month by month. */
  monthlyPace: number;
  monthsRemaining: number | null; // null = not enough billing history to project
}

export async function getBacklog(): Promise<Backlog> {
  const [finances, cashflow] = await Promise.all([getProjectFinances(), getMonthlyCashflow(3)]);
  const active = finances.filter((f) => (ONGOING_STATUSES as string[]).includes(f.status) || f.status === "SITE_SURVEY");
  const totalContract = active.reduce((s, f) => s + f.contractValue, 0);
  const earnedToDate = active.reduce((s, f) => s + (f.contractValue * f.accomplishmentPct) / 100, 0);
  const backlogRemaining = Math.max(totalContract - earnedToDate, 0);
  const monthsWithInflow = cashflow.filter((m) => m.inflow > 0);
  const monthlyPace =
    monthsWithInflow.length > 0 ? monthsWithInflow.reduce((s, m) => s + m.inflow, 0) / monthsWithInflow.length : 0;
  return {
    totalContract,
    earnedToDate,
    backlogRemaining,
    monthlyPace,
    monthsRemaining: monthlyPace > 0 ? backlogRemaining / monthlyPace : null,
  };
}

// ---------- Cash runway (straight-line, off trailing net burn) ----------

export interface CashRunway {
  cashOnHand: number | null; // null = no snapshot recorded yet
  weeklyBurn: number; // positive = spending down; negative = building up
  weeksOfRunway: number | null;
  safeFloor: number; // suggested floor: one trailing month of gross outflow
}

export async function getCashRunway(): Promise<CashRunway> {
  const [snapshot, cashflow] = await Promise.all([getLatestCashSnapshot(), getMonthlyCashflow(3)]);
  const avgOutflow = cashflow.reduce((s, m) => s + m.outflow, 0) / cashflow.length;
  const avgInflow = cashflow.reduce((s, m) => s + m.inflow, 0) / cashflow.length;
  const weeklyBurn = (avgOutflow - avgInflow) / 4.345;
  const cashOnHand = snapshot?.amount ?? null;
  return {
    cashOnHand,
    weeklyBurn,
    weeksOfRunway: cashOnHand != null && weeklyBurn > 0 ? cashOnHand / weeklyBurn : null,
    safeFloor: avgOutflow,
  };
}

// ---------- Receivables aging (proxy: days since billed — PaymentTerm has no due date) ----------

export interface AgingBucket {
  label: string;
  total: number;
}

export async function getReceivablesAging(): Promise<{ buckets: AgingBucket[]; total: number }> {
  const terms = await prisma.paymentTerm.findMany({
    where: { status: { in: ["PENDING", "DUE"] } },
    select: { amount: true, createdAt: true },
  });
  const now = Date.now();
  const buckets = [
    { label: "0–30 days", max: 30, total: 0 },
    { label: "31–60 days", max: 60, total: 0 },
    { label: "61–90 days", max: 90, total: 0 },
    { label: "Over 90 days", max: Infinity, total: 0 },
  ];
  for (const t of terms) {
    const days = (now - t.createdAt.getTime()) / 86_400_000;
    const bucket = buckets.find((b) => days <= b.max) ?? buckets[buckets.length - 1];
    bucket.total += Number(t.amount);
  }
  return {
    buckets: buckets.map((b) => ({ label: b.label, total: b.total })),
    total: buckets.reduce((s, b) => s + b.total, 0),
  };
}

// ---------- Bid pipeline (Leads → Quotations) ----------

const STAGE_LABELS: Record<string, string> = {
  NEW: "Identified",
  UNDER_REVIEW: "Under review",
  ESTIMATE_IN_PROGRESS: "Estimating",
  QUOTATION_SENT: "Submitted",
};
const STAGE_ORDER = ["NEW", "UNDER_REVIEW", "ESTIMATE_IN_PROGRESS", "QUOTATION_SENT"] as const;
// Rough, standard sales-funnel discount applied to each stage's face value —
// not derived from this company's own conversion history (too few leads yet
// to fit one), just a reasonable industry default for "weighted pipeline."
const STAGE_WEIGHT: Record<string, number> = {
  NEW: 0.1,
  UNDER_REVIEW: 0.25,
  ESTIMATE_IN_PROGRESS: 0.5,
  QUOTATION_SENT: 0.75,
};

export function quotationTotal(q: {
  markupPct: unknown;
  vatPct: unknown;
  lineItems: { qty: unknown; unitPrice: unknown }[];
}): number {
  const subtotal = q.lineItems.reduce((s, li) => s + Number(li.qty) * Number(li.unitPrice), 0);
  const markup = subtotal * (Number(q.markupPct) / 100);
  const vat = (subtotal + markup) * (Number(q.vatPct) / 100);
  return subtotal + markup + vat;
}

export interface PipelineStage {
  status: string;
  label: string;
  count: number;
  value: number;
}

export async function getBidPipeline(): Promise<{
  stages: PipelineStage[];
  winRate: number | null;
  weightedPipeline: number;
}> {
  const leads = await prisma.lead.findMany({
    where: { status: { in: [...STAGE_ORDER] } },
    include: { quotations: { include: { lineItems: true }, orderBy: { createdAt: "desc" }, take: 1 } },
  });

  const stages: PipelineStage[] = STAGE_ORDER.map((status) => {
    const inStage = leads.filter((l) => l.status === status);
    const value = inStage.reduce((s, l) => s + (l.quotations[0] ? quotationTotal(l.quotations[0]) : 0), 0);
    return { status, label: STAGE_LABELS[status], count: inStage.length, value };
  });

  const [wonCount, lostCount] = await Promise.all([
    prisma.lead.count({ where: { status: "WON" } }),
    prisma.lead.count({ where: { status: "LOST" } }),
  ]);
  const decided = wonCount + lostCount;
  const weightedPipeline = stages.reduce((s, st) => s + st.value * (STAGE_WEIGHT[st.status] ?? 0), 0);

  return { stages, winRate: decided > 0 ? (wonCount / decided) * 100 : null, weightedPipeline };
}

// ---------- Needs-a-decision flags ----------

export interface RiskFlag {
  tone: "critical" | "warning";
  title: string;
  detail: string;
}

export async function getRiskFlags(): Promise<RiskFlag[]> {
  const [pendingCOs, aging, finances] = await Promise.all([
    prisma.changeOrder.findMany({ where: { status: "PENDING_CLIENT" }, include: { project: { select: { name: true } } } }),
    getReceivablesAging(),
    getProjectFinances(),
  ]);

  const flags: RiskFlag[] = [];

  if (pendingCOs.length > 0) {
    const total = pendingCOs.reduce((s, c) => s + Number(c.costImpact), 0);
    flags.push({
      tone: "critical",
      title: `₱${total.toLocaleString("en-PH")} of change orders awaiting client approval`,
      detail: pendingCOs.map((c) => c.project.name).join(", "),
    });
  }

  const over90 = aging.buckets.find((b) => b.label === "Over 90 days");
  if (over90 && over90.total > 0) {
    flags.push({
      tone: "warning",
      title: `₱${over90.total.toLocaleString("en-PH")} billed over 90 days ago, still unpaid`,
      detail: "Follow up on these payment terms before they age further.",
    });
  }

  const active = finances.filter((f) => (ONGOING_STATUSES as string[]).includes(f.status));
  const totalBacklogValue = active.reduce((s, f) => s + f.contractValue, 0);
  if (active.length > 1 && totalBacklogValue > 0) {
    const biggest = [...active].sort((a, b) => b.contractValue - a.contractValue)[0];
    const share = (biggest.contractValue / totalBacklogValue) * 100;
    if (share >= 50) {
      flags.push({
        tone: "warning",
        title: `${share.toFixed(0)}% of active contract value is one client`,
        detail: `${biggest.clientName} (${biggest.name}) — a delay there hits cashflow directly.`,
      });
    }
  }

  for (const f of active) {
    const projected = marginAtCompletion(f);
    if (projected < 10 && f.accomplishmentPct > 0) {
      flags.push({
        tone: projected < 0 ? "critical" : "warning",
        title: `${f.name} forecast to finish at ${projected.toFixed(1)}% margin`,
        detail: `Cost-to-date extrapolated across the remaining ${(100 - f.accomplishmentPct).toFixed(0)}% of scope.`,
      });
    }
  }

  return flags;
}
