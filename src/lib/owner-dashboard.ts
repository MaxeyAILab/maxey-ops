import { prisma } from "@/lib/prisma";
import { getNonProjectExpenses, runGross } from "@/lib/finance";
import { getBidPipeline, getCashRunway, type CashRunway } from "@/lib/finance-dashboard";
import { computeWorkItemStatuses, weightedAccomplishment } from "@/lib/progress";
import { fmtDate } from "@/lib/format";
import { computeForecast, type CostState } from "@/lib/forecast";
import { receivablesAging, type TermInput } from "@/lib/billing";
import { computeSchedule, type ScheduleState } from "@/lib/schedule";
import { requisitionAmount } from "@/lib/requisitions";
import { COMPLETED_STATUSES, ONGOING_STATUSES, STATUS_LABELS } from "@/lib/project-status";
import type { ProjectStatus } from "@prisma/client";

/**
 * Owner dashboard data. Everything here is computed from rows that exist —
 * where the schema can't answer a question (no incident log, no invoice due
 * dates, no project-manager field, no actual-cost postings) the value is
 * null / a labelled proxy, never a made-up number or a silent zero.
 */

export type Period = "30d" | "90d" | "ytd" | "12m";
export type Scope = "active" | "all";
export type Severity = 0 | 1 | 2; // 0 on plan · 1 watch · 2 critical

export interface DashboardFilters {
  period: Period;
  scope: Scope;
  clientId: string | null;
}

export const PERIOD_LABELS: Record<Period, string> = {
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  ytd: "Year to date",
  "12m": "Last 12 months",
};

export function parseFilters(sp: Record<string, string | string[] | undefined>): DashboardFilters {
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : (sp[k] as string | undefined));
  const period = one("period");
  const scope = one("scope");
  return {
    period: period === "30d" || period === "90d" || period === "ytd" || period === "12m" ? period : "90d",
    scope: scope === "all" ? "all" : "active",
    clientId: one("client") || null,
  };
}

const DAY = 86_400_000;
const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / DAY);

/** Manila-anchored start of the selected period. */
function periodRange(period: Period, now: Date) {
  const manilaYear = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric" }).format(now));
  const start =
    period === "30d"
      ? new Date(now.getTime() - 30 * DAY)
      : period === "90d"
        ? new Date(now.getTime() - 90 * DAY)
        : period === "12m"
          ? new Date(now.getTime() - 365 * DAY)
          : new Date(`${manilaYear}-01-01T00:00:00.000+08:00`);
  const length = now.getTime() - start.getTime();
  return { start, end: now, priorStart: new Date(start.getTime() - length) };
}

// ---------- Project rows ----------

export type { CostState } from "@/lib/forecast";
export type { ScheduleState } from "@/lib/schedule";

export interface Issue {
  severity: 1 | 2;
  label: string;
  nextAction: string;
}

export interface ProjectRow {
  id: string;
  name: string;
  code: string | null;
  clientName: string;
  status: ProjectStatus;
  statusLabel: string;
  isCompleted: boolean;
  isProspective: boolean;
  manager: string | null;
  contract: number;
  received: number;
  committed: number;
  labor: number;
  pct: number;
  lastProgressAt: Date | null;
  costState: CostState;
  forecastCost: number | null;
  forecastProfit: number | null;
  forecastMarginPct: number | null;
  targetMarginPct: number | null;
  scheduleState: ScheduleState;
  scheduleVarianceDays: number | null;
  plannedPct: number | null; // share of the start→target window already used
  targetEnd: Date | null;
  forecastFinish: Date | null;
  billingGap: number; // received − earned; negative = funding the work
  pendingCOs: number;
  pendingCOAmount: number;
  issues: Issue[];
  severity: Severity;
  deterioration: number;
}

export interface AttentionItem {
  key: string;
  severity: 1 | 2;
  title: string;
  detail: string;
  impact: string;
  impactAmount: number | null;
  owner: string;
  when: string;
  href: string;
}

export interface FlowBucket {
  label: string;
  inflow: number;
  outflow: number;
}

export interface DueTerm {
  projectId: string;
  projectName: string;
  clientName: string;
  label: string;
  outstanding: number;
}

export interface RetentionRow {
  projectId: string;
  projectName: string;
  clientName: string;
  amount: number;
}

export interface Freshness {
  source: string;
  at: Date | null;
  staleAfterDays: number;
}

export interface OwnerDashboardData {
  generatedAt: Date;
  filters: DashboardFilters;
  clients: { id: string; name: string }[];
  rows: ProjectRow[]; // selected scope (active, or active + completed)
  completedRows: ProjectRow[];
  kpis: {
    backlog: { remaining: number; contract: number; projects: number; prospectiveCount: number; prospectiveValue: number };
    margin: {
      profit: number | null;
      marginPct: number | null;
      targetPct: number | null;
      covered: number;
      total: number;
      coveredContractPct: number;
    };
    cash: {
      snapshot: { amount: number; at: Date; prevAmount: number | null; history: number[] } | null;
      netMovement: number;
      runway: CashRunway;
    };
    due: { total: number; terms: number; projects: number; overdueTotal: number; overdueCount: number; noDueDateTotal: number; hasDueDates: boolean };
    atRisk: { total: number; count: number; critical: number; top: string | null };
    pulse: { open: number; overdueInstructions: number; criticalRequisitions: number; permitIssues: number };
  };
  attention: AttentionItem[];
  attentionTotal: number;
  flows: {
    buckets: FlowBucket[];
    bucketing: "weekly" | "monthly";
    collected: number;
    priorCollected: number;
    committedOut: number;
    label: string;
  };
  dueTerms: DueTerm[];
  retention: { total: number; rows: RetentionRow[] };
  procurement: {
    pendingApproval: { count: number; amount: number; noEstimate: number };
    approvedNoPo: { count: number; amount: number };
    openPos: { count: number; amount: number };
    lateDeliveries: { count: number; amount: number };
  };
  pipeline: {
    stages: { label: string; count: number; value: number }[];
    weighted: number;
    winRate: number | null;
    prospectiveProjects: { count: number; value: number };
  };
  operations: {
    onDuty: number;
    pendingTimeRequests: number;
    unapprovedPayroll: number;
    overdueInstructions: number;
    permitIssues: number;
  };
  nonProject: { label: string; total: number; count: number }[];
  nonProjectTotal: number;
  freshness: Freshness[];
}

export async function getOwnerDashboard(filters: DashboardFilters): Promise<OwnerDashboardData> {
  const now = new Date();
  const range = periodRange(filters.period, now);
  const clientWhere = filters.clientId ? { clientId: filters.clientId } : {};

  const [
    projects,
    clients,
    paymentsInWindow,
    posInWindow,
    payrollInWindow,
    cashSnaps,
    runway,
    nonProject,
    pipeline,
    pendingReqs,
    openPoRows,
    approvedNoPoRows,
    overdueInstr,
    permits,
    onDuty,
    pendingTimeRequests,
    unapprovedPayroll,
    latestPayment,
    latestPayroll,
  ] = await Promise.all([
    prisma.project.findMany({
      where: { status: { not: "NOT_ACTIVE" }, ...clientWhere },
      include: {
        client: { select: { id: true, name: true } },
        payments: { select: { amount: true, paymentTermId: true } },
        paymentTerms: true,
        requisitions: {
          where: { status: { in: ["APPROVED", "PO_ISSUED", "DELIVERED"] } },
          include: { purchaseOrder: true },
        },
        payrollRuns: { where: { status: { in: ["APPROVED", "PAID"] } }, select: { entries: true } },
        progressEntries: {
          orderBy: { createdAt: "desc" },
          select: {
            workItem: true,
            weight: true,
            pctComplete: true,
            color: true,
            createdAt: true,
            reviewStatus: true,
            reviewedAt: true,
          },
        },
        changeOrders: {
          where: { status: "PENDING_CLIENT" },
          include: { createdBy: { select: { name: true } } },
        },
        assignments: {
          where: { active: true },
          include: { user: { select: { name: true, role: true } } },
        },
      },
    }),
    prisma.client.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.payment.findMany({
      where: {
        dateReceived: { gte: range.priorStart },
        ...(filters.clientId ? { project: { clientId: filters.clientId } } : {}),
      },
      select: { amount: true, dateReceived: true },
    }),
    prisma.purchaseOrder.findMany({
      where: {
        createdAt: { gte: range.start },
        status: { not: "CANCELLED" },
        ...(filters.clientId ? { requisition: { project: { clientId: filters.clientId } } } : {}),
      },
      select: { totalCost: true, createdAt: true },
    }),
    prisma.payrollRun.findMany({
      where: {
        status: { in: ["APPROVED", "PAID"] },
        createdAt: { gte: range.start },
        ...(filters.clientId ? { project: { clientId: filters.clientId } } : {}),
      },
      select: { entries: true, createdAt: true },
    }),
    prisma.cashSnapshot.findMany({ orderBy: { recordedAt: "desc" }, take: 8 }),
    getCashRunway(),
    getNonProjectExpenses(),
    getBidPipeline(),
    prisma.requisition.findMany({
      where: { status: { in: ["SUBMITTED", "UNDER_REVIEW"] } },
      include: {
        project: { select: { name: true, id: true } },
        submittedBy: { select: { name: true } },
      },
    }),
    prisma.purchaseOrder.findMany({
      where: { status: { in: ["OPEN", "PARTIALLY_DELIVERED"] } },
      select: { totalCost: true, deliveryDate: true },
    }),
    prisma.requisition.findMany({
      where: { status: "APPROVED", purchaseOrder: null },
      select: { estimatedCost: true },
    }),
    prisma.siteInstruction.findMany({
      where: { dueDate: { lt: now }, status: { notIn: ["COMPLETED", "CANCELLED"] } },
      select: { priority: true },
    }),
    prisma.permit.findMany({
      where: { expiryDate: { lte: new Date(now.getTime() + 30 * DAY) } },
      orderBy: { expiryDate: "asc" },
    }),
    prisma.attendance.count({ where: { timeOut: null } }),
    prisma.timeAdjustmentRequest.count({ where: { status: "PENDING" } }),
    prisma.payrollRun.count({ where: { status: { in: ["DRAFT", "REVIEW"] } } }),
    prisma.payment.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.payrollRun.findFirst({
      where: { status: { in: ["APPROVED", "PAID"] } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);

  // ----- per-project rows -----
  const targets = await prisma.project.findMany({
    where: { id: { in: projects.map((p) => p.id) } },
    select: { id: true, targetMarginPct: true, startDate: true, targetEndDate: true },
  });
  const targetById = new Map(targets.map((t) => [t.id, t]));

  const allRows: ProjectRow[] = projects.map((p) => {
    const t = targetById.get(p.id);
    const contract = Number(p.contractValue);
    const received = p.payments.reduce((s, x) => s + Number(x.amount), 0);
    const labor = p.payrollRuns.reduce((s, r) => s + runGross(r.entries), 0);
    const committed = labor + p.requisitions.reduce((s, r) => s + requisitionAmount(r), 0);
    const pct = weightedAccomplishment(computeWorkItemStatuses(p.progressEntries));
    const lastProgressAt = p.progressEntries[0]?.createdAt ?? null;
    const isCompleted = (COMPLETED_STATUSES as string[]).includes(p.status);
    const targetMarginPct = t?.targetMarginPct != null ? Number(t.targetMarginPct) : null;

    const { costState, forecastCost, forecastProfit, forecastMarginPct } = computeForecast({
      contract,
      committed,
      pct,
      isCompleted,
    });

    const targetEnd = t?.targetEndDate ?? null;
    const {
      state: scheduleState,
      varianceDays: scheduleVarianceDays,
      plannedPct,
      forecastFinish,
    } = computeSchedule({ now, start: t?.startDate ?? null, targetEnd, pct, isCompleted });

    const earned = (contract * pct) / 100;
    const billingGap = received - earned;
    const pendingCOAmount = p.changeOrders.reduce((s, c) => s + Number(c.costImpact), 0);
    const oldestCO = p.changeOrders.reduce<Date | null>(
      (min, c) => (min == null || c.createdAt < min ? c.createdAt : min),
      null
    );

    // issues
    const issues: Issue[] = [];
    const ongoing = (ONGOING_STATUSES as string[]).includes(p.status);
    if (!isCompleted) {
      if (forecastMarginPct != null && costState === "ok") {
        if (forecastMarginPct < 0)
          issues.push({
            severity: 2,
            label: `Forecast loss (⟦${forecastMarginPct.toFixed(1)}%⟧ margin)`,
            nextAction: "Review cost overrun with PM",
          });
        else if (targetMarginPct != null && forecastMarginPct < targetMarginPct - 2)
          issues.push({
            severity: 1,
            label: `Margin ⟦${forecastMarginPct.toFixed(1)}%⟧ vs ⟦${targetMarginPct.toFixed(0)}%⟧ target`,
            nextAction: "Check cost vs progress",
          });
        else if (targetMarginPct == null && forecastMarginPct < 10)
          issues.push({
            severity: 1,
            label: `Thin forecast margin (⟦${forecastMarginPct.toFixed(1)}%⟧)`,
            nextAction: "Set a target margin and review costs",
          });
      }
      if (costState === "no-cost" && ongoing)
        issues.push({ severity: 1, label: "Progress reported, no cost recorded", nextAction: "Post approved costs" });
      if (scheduleState === "overdue")
        issues.push({
          severity: scheduleVarianceDays! > 14 ? 2 : 1,
          label: `Past target finish by ${scheduleVarianceDays} days`,
          nextAction: "Agree a revised finish date",
        });
      else if (scheduleState === "late" || scheduleState === "watch")
        issues.push({
          severity: scheduleState === "late" ? 2 : 1,
          label: `Behind plan: ${pct.toFixed(0)}% done, ${plannedPct!.toFixed(0)}% of time used`,
          nextAction: scheduleState === "late" ? "Review schedule recovery" : "Watch schedule",
        });
      if (p.status === "ON_HOLD") issues.push({ severity: 1, label: "Project on hold", nextAction: "Decide restart date" });
      if (p.status === "ONGOING_CONSTRUCTION" || p.status === "MOBILIZATION") {
        const staleDays = lastProgressAt ? daysBetween(lastProgressAt, now) : null;
        if (staleDays == null)
          issues.push({ severity: 1, label: "No progress reported yet", nextAction: "Ask foreman for a progress entry" });
        else if (staleDays > 14)
          issues.push({ severity: 1, label: `No progress update in ${staleDays} days`, nextAction: "Ask foreman for a progress entry" });
      }
      if (p.changeOrders.length > 0)
        issues.push({
          severity: oldestCO && daysBetween(oldestCO, now) > 14 ? 2 : 1,
          label: `${p.changeOrders.length} change order${p.changeOrders.length === 1 ? "" : "s"} awaiting client`,
          nextAction: "Follow up with client",
        });
      if (contract > 0 && billingGap < -0.2 * contract && pct > 0)
        issues.push({ severity: 1, label: "Billing is behind earned value", nextAction: "Raise the next billing" });
    }
    issues.sort((a, b) => b.severity - a.severity);
    const severity = (issues[0]?.severity ?? 0) as Severity;
    const reference = targetMarginPct ?? 10;
    const deterioration = forecastMarginPct != null && costState === "ok" ? reference - forecastMarginPct : 0;

    return {
      id: p.id,
      name: p.name,
      code: p.code,
      clientName: p.client.name,
      status: p.status,
      statusLabel: STATUS_LABELS[p.status],
      isCompleted,
      isProspective: p.status === "SITE_SURVEY",
      manager: p.assignments.find((a) => a.user.role === "PM")?.user.name ?? null,
      contract,
      received,
      committed,
      labor,
      pct,
      lastProgressAt,
      costState,
      forecastCost,
      forecastProfit,
      forecastMarginPct,
      targetMarginPct,
      scheduleState,
      scheduleVarianceDays,
      plannedPct,
      targetEnd,
      forecastFinish,
      billingGap,
      pendingCOs: p.changeOrders.length,
      pendingCOAmount,
      issues,
      severity,
      deterioration,
    };
  });

  const activeRows = allRows.filter((r) => (ONGOING_STATUSES as string[]).includes(r.status));
  const completedRows = allRows.filter((r) => r.isCompleted);
  const prospectiveRows = allRows.filter((r) => r.status === "SITE_SURVEY");
  const rows = (filters.scope === "all" ? [...activeRows, ...prospectiveRows, ...completedRows] : activeRows).sort(
    (a, b) => b.severity - a.severity || b.deterioration - a.deterioration || b.contract - a.contract
  );

  // ----- KPIs -----
  const backlogRemaining = activeRows.reduce((s, r) => s + Math.max(r.contract * (1 - r.pct / 100), 0), 0);
  const activeContract = activeRows.reduce((s, r) => s + r.contract, 0);

  const forecastable = rows.filter((r) => !r.isProspective);
  const reliable = forecastable.filter((r) => r.forecastProfit != null && (r.costState === "ok" || r.costState === "final"));
  const reliableContract = reliable.reduce((s, r) => s + r.contract, 0);
  const rowsContract = forecastable.reduce((s, r) => s + r.contract, 0);
  const marginProfit = reliable.length > 0 ? reliable.reduce((s, r) => s + r.forecastProfit!, 0) : null;
  const targetRows = reliable.filter((r) => r.targetMarginPct != null);
  const targetContract = targetRows.reduce((s, r) => s + r.contract, 0);

  // receivables due: milestones marked DUE, net of payments recorded against them
  const dueTerms: DueTerm[] = [];
  const retentionRows: RetentionRow[] = [];
  const allTerms: TermInput[] = [];
  for (const p of projects) {
    if (!rows.some((r) => r.id === p.id) && !completedRows.some((r) => r.id === p.id)) continue;
    const paidByTerm = new Map<string, number>();
    for (const pay of p.payments)
      if (pay.paymentTermId) paidByTerm.set(pay.paymentTermId, (paidByTerm.get(pay.paymentTermId) ?? 0) + Number(pay.amount));
    for (const t of p.paymentTerms) {
      allTerms.push({
        status: t.status,
        amount: Number(t.amount),
        paid: paidByTerm.get(t.id) ?? 0,
        invoicedAt: t.invoicedAt,
        certifiedAt: t.certifiedAt,
        dueDate: t.dueDate,
      });
      if (t.status === "DUE") {
        const outstanding = Math.max(Number(t.amount) - (paidByTerm.get(t.id) ?? 0), 0);
        if (outstanding > 0)
          dueTerms.push({
            projectId: p.id,
            projectName: p.name,
            clientName: p.client.name,
            label: t.label,
            outstanding,
          });
      }
    }
    const held = p.paymentTerms
      .filter((t) => t.type === "RETENTION" && t.status !== "PAID")
      .reduce((s, t) => s + Number(t.amount), 0);
    if (held > 0) retentionRows.push({ projectId: p.id, projectName: p.name, clientName: p.client.name, amount: held });
  }
  dueTerms.sort((a, b) => b.outstanding - a.outstanding);
  retentionRows.sort((a, b) => b.amount - a.amount);
  const dueTotal = dueTerms.reduce((s, t) => s + t.outstanding, 0);
  const aging = receivablesAging(allTerms, now);
  const hasDueDates = allTerms.some((t) => t.dueDate != null);

  // cash flow buckets
  const bucketing: "weekly" | "monthly" = filters.period === "30d" || filters.period === "90d" ? "weekly" : "monthly";
  const buckets: FlowBucket[] = [];
  const bucketOf: (d: Date) => number = (() => {
    if (bucketing === "weekly") {
      const weekMs = 7 * DAY;
      const n = Math.ceil((range.end.getTime() - range.start.getTime()) / weekMs);
      const fmt = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric" });
      for (let i = 0; i < n; i++) buckets.push({ label: fmt.format(new Date(range.start.getTime() + i * weekMs)), inflow: 0, outflow: 0 });
      return (d) => Math.floor((d.getTime() - range.start.getTime()) / weekMs);
    }
    const fmt = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", month: "short", year: "2-digit" });
    const keyOf = (d: Date) => fmt.format(d);
    const cursor = new Date(range.start);
    cursor.setDate(1);
    while (cursor <= range.end) {
      buckets.push({ label: keyOf(cursor), inflow: 0, outflow: 0 });
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return (d) => buckets.findIndex((b) => b.label === keyOf(d));
  })();
  let collected = 0;
  let priorCollected = 0;
  for (const pay of paymentsInWindow) {
    if (pay.dateReceived < range.start) priorCollected += Number(pay.amount);
    else {
      collected += Number(pay.amount);
      const i = bucketOf(pay.dateReceived);
      if (i >= 0 && i < buckets.length) buckets[i].inflow += Number(pay.amount);
    }
  }
  let committedOut = 0;
  for (const po of posInWindow) {
    committedOut += Number(po.totalCost);
    const i = bucketOf(po.createdAt);
    if (i >= 0 && i < buckets.length) buckets[i].outflow += Number(po.totalCost);
  }
  for (const run of payrollInWindow) {
    const amt = runGross(run.entries);
    committedOut += amt;
    const i = bucketOf(run.createdAt);
    if (i >= 0 && i < buckets.length) buckets[i].outflow += amt;
  }

  // cash snapshot
  const snap = cashSnaps[0] ?? null;
  const cashSnapshot = snap
    ? {
        amount: Number(snap.amount),
        at: snap.recordedAt,
        prevAmount: cashSnaps[1] ? Number(cashSnaps[1].amount) : null,
        history: cashSnaps.map((c) => Number(c.amount)).reverse(),
      }
    : null;

  // pulse
  const overdueInstructions = overdueInstr.length;
  const criticalRequisitions = pendingReqs.filter((r) => r.urgency === "CRITICAL" || r.urgency === "HIGH").length;
  const permitIssues = permits.length;
  const pulseOpen = overdueInstructions + criticalRequisitions + permitIssues;

  // procurement
  const sumEst = (rs: { estimatedCost: unknown }[]) => rs.reduce((s, r) => s + Number(r.estimatedCost ?? 0), 0);
  const lateDeliveries = openPoRows.filter((po) => po.deliveryDate && po.deliveryDate < now);

  // ----- needs attention -----
  const attentionAll: AttentionItem[] = [];
  const toAttention = (r: ProjectRow) => {
    const top = r.issues[0];
    if (!top) return;
    const shortfall =
      r.forecastProfit != null && r.targetMarginPct != null && r.costState === "ok"
        ? r.contract * (r.targetMarginPct / 100) - r.forecastProfit
        : null;
    attentionAll.push({
      key: `proj-${r.id}`,
      severity: top.severity,
      title: r.name,
      detail:
        top.label + (r.issues.length > 1 ? ` · +${r.issues.length - 1} more` : "") + ` — ${top.nextAction}`,
      impact: shortfall != null && shortfall > 0 ? "below target" : top.label.includes("plan") || top.label.includes("target finish") ? "schedule" : "",
      impactAmount: shortfall != null && shortfall > 0 ? shortfall : null,
      owner: r.manager ?? "Unassigned",
      when: r.targetEnd ? `Target ${fmtDate(r.targetEnd)}` : "No target date",
      href: `/projects/${r.id}`,
    });
  };
  for (const r of rows) if (!r.isCompleted && !r.isProspective) toAttention(r);
  for (const p of projects)
    for (const co of p.changeOrders) {
      const age = daysBetween(co.createdAt, now);
      attentionAll.push({
        key: `co-${co.id}`,
        severity: age > 14 ? 2 : 1,
        title: `Change order awaiting client — ${co.title}`,
        detail: p.name,
        impact: "cost impact",
        impactAmount: Number(co.costImpact),
        owner: co.createdBy.name,
        when: `Waiting ${age}d`,
        href: `/projects/${p.id}`,
      });
    }
  for (const r of pendingReqs) {
    const age = daysBetween(r.submittedAt, now);
    if (r.urgency === "CRITICAL" || r.urgency === "HIGH" || age > 3)
      attentionAll.push({
        key: `req-${r.id}`,
        severity: r.urgency === "CRITICAL" ? 2 : 1,
        title: `Requisition awaiting approval (${r.urgency.toLowerCase()})`,
        detail: r.project?.name ?? "Non-project",
        impact: "estimate",
        impactAmount: r.estimatedCost != null ? Number(r.estimatedCost) : null,
        owner: r.submittedBy.name,
        when: `Waiting ${age}d`,
        href: "/requisitions",
      });
  }
  if (dueTotal > 0 || aging.overdueTotal > 0)
    attentionAll.push({
      key: "due",
      severity: aging.overdueCount > 0 ? 2 : 1,
      title: aging.overdueCount > 0 ? `${aging.overdueCount} payment${aging.overdueCount === 1 ? "" : "s"} past the due date` : `${dueTerms.length} billing milestone${dueTerms.length === 1 ? "" : "s"} due for collection`,
      detail: dueTerms.slice(0, 2).map((t) => t.clientName).join(", ") + (dueTerms.length > 2 ? "…" : ""),
      impact: aging.overdueCount > 0 ? "overdue" : "to collect",
      impactAmount: aging.overdueCount > 0 ? aging.overdueTotal : dueTotal,
      owner: "Accounting",
      when: "Milestone due",
      href: "/finance",
    });
  if (overdueInstructions > 0)
    attentionAll.push({
      key: "instr",
      severity: overdueInstr.some((i) => i.priority === "CRITICAL") ? 2 : 1,
      title: `${overdueInstructions} site instruction${overdueInstructions === 1 ? "" : "s"} past due date`,
      detail: "Open instructions not yet completed",
      impact: "",
      impactAmount: null,
      owner: "Assignees",
      when: "Overdue",
      href: "/instructions",
    });
  for (const pm of permits) {
    const expired = pm.expiryDate < now;
    attentionAll.push({
      key: `permit-${pm.id}`,
      severity: expired ? 2 : 1,
      title: `Permit ${expired ? "expired" : "expiring"} — ${pm.name}`,
      detail: pm.issuingBody ?? "Permit",
      impact: "",
      impactAmount: null,
      owner: "Admin",
      when: expired ? `Expired ${daysBetween(pm.expiryDate, now)}d ago` : `In ${daysBetween(now, pm.expiryDate)}d`,
      href: "/people",
    });
  }
  attentionAll.sort((a, b) => b.severity - a.severity || (b.impactAmount ?? 0) - (a.impactAmount ?? 0));

  const atRiskRows = rows.filter((r) => r.severity > 0 && !r.isCompleted && !r.isProspective);
  const atRiskTop =
    [...atRiskRows].sort((a, b) => b.severity - a.severity)[0]?.issues[0]?.label ?? null;

  return {
    generatedAt: now,
    filters,
    clients,
    rows,
    completedRows,
    kpis: {
      backlog: {
        remaining: backlogRemaining,
        contract: activeContract,
        projects: activeRows.length,
        prospectiveCount: prospectiveRows.length,
        prospectiveValue: prospectiveRows.reduce((sum, r) => sum + r.contract, 0),
      },
      margin: {
        profit: marginProfit,
        marginPct: marginProfit != null && reliableContract > 0 ? (marginProfit / reliableContract) * 100 : null,
        targetPct:
          targetContract > 0
            ? targetRows.reduce((s, r) => s + r.contract * r.targetMarginPct!, 0) / targetContract
            : null,
        covered: reliable.length,
        total: forecastable.length,
        coveredContractPct: rowsContract > 0 ? (reliableContract / rowsContract) * 100 : 0,
      },
      cash: { snapshot: cashSnapshot, netMovement: collected - committedOut, runway },
      due: {
        total: dueTotal,
        terms: dueTerms.length,
        projects: new Set(dueTerms.map((t) => t.projectId)).size,
        overdueTotal: aging.overdueTotal,
        overdueCount: aging.overdueCount,
        noDueDateTotal: aging.noDueDate,
        hasDueDates,
      },
      atRisk: { total: activeRows.length, count: atRiskRows.length, critical: atRiskRows.filter((r) => r.severity === 2).length, top: atRiskTop },
      pulse: { open: pulseOpen, overdueInstructions, criticalRequisitions, permitIssues },
    },
    attention: attentionAll.slice(0, 6),
    attentionTotal: attentionAll.length,
    flows: {
      buckets,
      bucketing,
      collected,
      priorCollected,
      committedOut,
      label: PERIOD_LABELS[filters.period],
    },
    dueTerms: dueTerms.slice(0, 6),
    retention: { total: retentionRows.reduce((s, r) => s + r.amount, 0), rows: retentionRows.slice(0, 6) },
    procurement: {
      pendingApproval: {
        count: pendingReqs.length,
        amount: sumEst(pendingReqs),
        noEstimate: pendingReqs.filter((r) => r.estimatedCost == null).length,
      },
      approvedNoPo: { count: approvedNoPoRows.length, amount: sumEst(approvedNoPoRows) },
      openPos: { count: openPoRows.length, amount: openPoRows.reduce((s, p) => s + Number(p.totalCost), 0) },
      lateDeliveries: { count: lateDeliveries.length, amount: lateDeliveries.reduce((s, p) => s + Number(p.totalCost), 0) },
    },
    pipeline: {
      stages: pipeline.stages.map((s) => ({ label: s.label, count: s.count, value: s.value })),
      weighted: pipeline.weightedPipeline,
      winRate: pipeline.winRate,
      prospectiveProjects: { count: prospectiveRows.length, value: prospectiveRows.reduce((s, r) => s + r.contract, 0) },
    },
    operations: {
      onDuty,
      pendingTimeRequests,
      unapprovedPayroll,
      overdueInstructions,
      permitIssues,
    },
    nonProject: nonProject.byCategory.map((c) => ({ label: c.label, total: c.total, count: c.count })),
    nonProjectTotal: nonProject.total,
    freshness: [
      {
        source: "Progress",
        at: activeRows.reduce<Date | null>(
          (max, r) => (r.lastProgressAt && (!max || r.lastProgressAt > max) ? r.lastProgressAt : max),
          null
        ),
        staleAfterDays: 14,
      },
      { source: "Payments", at: latestPayment?.createdAt ?? null, staleAfterDays: 45 },
      { source: "Payroll", at: latestPayroll?.createdAt ?? null, staleAfterDays: 21 },
      { source: "Cash balance", at: snap?.recordedAt ?? null, staleAfterDays: 14 },
    ],
  };
}
