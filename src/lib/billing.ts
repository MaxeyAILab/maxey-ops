import { dayIndex, manilaToday } from "@/lib/milestones";

/**
 * Billing and commercial rules. Three ideas run through everything here:
 *  - an invoice is not cash received — only recorded payments reduce what is owed;
 *  - lateness is only measured against a due date someone actually entered;
 *  - a pending requisition is a request, not a commitment.
 */

export type BillingState = "paid" | "overdue" | "partial" | "billed" | "due-not-invoiced" | "not-billed";

export interface TermInput {
  status: "PENDING" | "DUE" | "PAID";
  amount: number;
  paid: number; // sum of recorded payments against this term
  invoicedAt: Date | null;
  certifiedAt: Date | null;
  dueDate: Date | null;
}

export interface TermState {
  state: BillingState;
  outstanding: number;
  /** Days past the due date; only set when the term is overdue. */
  daysOverdue: number | null;
  certified: boolean;
}

export const BILLING_LABEL: Record<BillingState, string> = {
  paid: "Paid",
  overdue: "Overdue",
  partial: "Partly paid",
  billed: "Billed — awaiting payment",
  "due-not-invoiced": "Due — not yet invoiced",
  "not-billed": "Not yet billed",
};

export function paymentTermState(t: TermInput, now: Date): TermState {
  const certified = t.certifiedAt != null;
  if (t.status === "PAID" || (t.amount > 0 && t.paid >= t.amount)) {
    return { state: "paid", outstanding: 0, daysOverdue: null, certified };
  }
  const outstanding = Math.max(t.amount - t.paid, 0);
  const today = manilaToday(now);
  const due = dayIndex(t.dueDate);
  // Overdue needs an invoice (we can't expect payment on a bill never issued) and a real due date.
  if (t.invoicedAt && due != null && due < today) {
    return { state: "overdue", outstanding, daysOverdue: today - due, certified };
  }
  if (t.paid > 0) return { state: "partial", outstanding, daysOverdue: null, certified };
  if (t.invoicedAt) return { state: "billed", outstanding, daysOverdue: null, certified };
  if (t.status === "DUE") return { state: "due-not-invoiced", outstanding, daysOverdue: null, certified };
  return { state: "not-billed", outstanding, daysOverdue: null, certified };
}

export interface AgingResult {
  notYetDue: number;
  days1to30: number;
  days31to60: number;
  days61to90: number;
  days90plus: number;
  /** Invoiced and unpaid but no due date entered — lateness unknown, never counted as on time. */
  noDueDate: number;
  /** Marked due but no invoice issued yet — ready to bill. */
  notInvoiced: number;
  overdueTotal: number;
  overdueCount: number;
}

export function receivablesAging(terms: TermInput[], now: Date): AgingResult {
  const r: AgingResult = { notYetDue: 0, days1to30: 0, days31to60: 0, days61to90: 0, days90plus: 0, noDueDate: 0, notInvoiced: 0, overdueTotal: 0, overdueCount: 0 };
  const today = manilaToday(now);
  for (const t of terms) {
    const s = paymentTermState(t, now);
    if (s.outstanding <= 0) continue;
    if (s.state === "overdue") {
      const d = s.daysOverdue!;
      if (d <= 30) r.days1to30 += s.outstanding;
      else if (d <= 60) r.days31to60 += s.outstanding;
      else if (d <= 90) r.days61to90 += s.outstanding;
      else r.days90plus += s.outstanding;
      r.overdueTotal += s.outstanding;
      r.overdueCount++;
    } else if (t.invoicedAt) {
      const due = dayIndex(t.dueDate);
      if (due == null) r.noDueDate += s.outstanding;
      else if (due >= today) r.notYetDue += s.outstanding;
    } else if (t.status === "DUE") {
      r.notInvoiced += s.outstanding;
    }
  }
  return r;
}

export interface RetentionRow {
  id: string;
  label: string;
  outstanding: number;
  releaseDate: Date | null;
  daysUntil: number | null; // negative = release date has passed
  overdue: boolean | null; // null when no release date is recorded
}

/** Retention still held, soonest release first; terms with no release date go last and are never called overdue. */
export function retentionSchedule(
  terms: { id: string; label: string; type: string; status: string; amount: number; paid: number; retentionReleaseDate: Date | null }[],
  now: Date
): RetentionRow[] {
  const today = manilaToday(now);
  return terms
    .filter((t) => t.type === "RETENTION" && t.status !== "PAID" && t.amount - t.paid > 0)
    .map((t) => {
      const rel = dayIndex(t.retentionReleaseDate);
      return {
        id: t.id,
        label: t.label,
        outstanding: t.amount - t.paid,
        releaseDate: t.retentionReleaseDate,
        daysUntil: rel == null ? null : rel - today,
        overdue: rel == null ? null : rel < today,
      };
    })
    .sort((a, b) => (a.daysUntil ?? Infinity) - (b.daysUntil ?? Infinity));
}

export interface CommitmentSummary {
  /** Requested, not approved — NOT a commitment. */
  pending: { count: number; amount: number };
  /** Approved, no purchase order yet — committed at the estimate. */
  approved: { count: number; amount: number; withoutEstimate: number };
  /** Purchase order issued, goods not yet delivered — committed at the PO amount. */
  ordered: { count: number; amount: number };
  delivered: { count: number; amount: number };
  rejected: number;
  /** approved + ordered + delivered: the figure used as "committed cost" (before payroll). */
  committedTotal: number;
}

export function commitmentSummary(
  reqs: { status: string; estimatedCost: number | null; po: { totalCost: number; status: string } | null }[]
): CommitmentSummary {
  const s: CommitmentSummary = {
    pending: { count: 0, amount: 0 },
    approved: { count: 0, amount: 0, withoutEstimate: 0 },
    ordered: { count: 0, amount: 0 },
    delivered: { count: 0, amount: 0 },
    rejected: 0,
    committedTotal: 0,
  };
  for (const r of reqs) {
    if (r.status === "SUBMITTED" || r.status === "UNDER_REVIEW") {
      s.pending.count++;
      s.pending.amount += r.estimatedCost ?? 0;
    } else if (r.status === "REJECTED") {
      s.rejected++;
    } else if (r.status === "APPROVED" || r.status === "PO_ISSUED" || r.status === "DELIVERED") {
      // Same rule as requisitionAmount(): a cancelled PO commits nothing; a live PO beats the estimate.
      const amount = r.po ? (r.po.status === "CANCELLED" ? 0 : r.po.totalCost) : (r.estimatedCost ?? 0);
      if (r.status === "DELIVERED") {
        s.delivered.count++;
        s.delivered.amount += amount;
      } else if (r.po) {
        s.ordered.count++;
        s.ordered.amount += amount;
      } else {
        s.approved.count++;
        s.approved.amount += amount;
        if (!r.estimatedCost) s.approved.withoutEstimate++;
      }
      s.committedTotal += amount;
    }
  }
  return s;
}

export interface ContractReconciliation {
  /** Contract value before any approved change order (derived, not stored). */
  original: number;
  approvedCount: number;
  approvedTotal: number;
  current: number;
  pendingCount: number;
  pendingTotal: number;
  potentialCount: number;
  potentialPricedTotal: number;
  potentialUnpriced: number;
  /** True when approved change orders add up to more than the current contract value — a data problem worth a look. */
  inconsistent: boolean;
}

export function reconcileContract(input: {
  currentContract: number;
  changeOrders: { status: string; costImpact: number; estimatedCost: number | null }[];
}): ContractReconciliation {
  const approved = input.changeOrders.filter((c) => c.status === "APPROVED");
  const pending = input.changeOrders.filter((c) => c.status === "PENDING_CLIENT");
  const potential = input.changeOrders.filter((c) => c.status === "POTENTIAL");
  const approvedTotal = approved.reduce((s, c) => s + c.costImpact, 0);
  const original = input.currentContract - approvedTotal;
  return {
    original,
    approvedCount: approved.length,
    approvedTotal,
    current: input.currentContract,
    pendingCount: pending.length,
    pendingTotal: pending.reduce((s, c) => s + c.costImpact, 0),
    potentialCount: potential.length,
    potentialPricedTotal: potential.reduce((s, c) => s + (c.estimatedCost ?? 0), 0),
    potentialUnpriced: potential.filter((c) => c.estimatedCost == null).length,
    inconsistent: original < 0,
  };
}

export interface BillingCoverage {
  termsTotal: number;
  contract: number;
  difference: number; // contract - termsTotal
  status: "complete" | "under" | "over" | "none";
}

/** Do the billing terms add up to the contract value? Within ₱1 counts as complete. */
export function billingCoverage(termAmounts: number[], contract: number): BillingCoverage {
  const termsTotal = termAmounts.reduce((s, a) => s + a, 0);
  const difference = contract - termsTotal;
  const status = termAmounts.length === 0 ? "none" : Math.abs(difference) <= 1 ? "complete" : difference > 0 ? "under" : "over";
  return { termsTotal, contract, difference, status };
}

export interface CostFreshness {
  costAt: Date | null;
  costAgeDays: number | null;
  costStale: boolean;
}

/** How old the cost data behind a forecast is. No cost data at all is reported as such, not as fresh. */
export function costFreshness(latestCostAt: Date | null, now: Date, staleAfterDays = 30): CostFreshness {
  if (!latestCostAt) return { costAt: null, costAgeDays: null, costStale: false };
  const age = Math.max(0, Math.floor((now.getTime() - latestCostAt.getTime()) / 86_400_000));
  return { costAt: latestCostAt, costAgeDays: age, costStale: age > staleAfterDays };
}
