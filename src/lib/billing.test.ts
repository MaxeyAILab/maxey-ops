import { describe, expect, it } from "vitest";
import {
  billingCoverage,
  commitmentSummary,
  costFreshness,
  paymentTermState,
  receivablesAging,
  reconcileContract,
  retentionSchedule,
  type TermInput,
} from "./billing";
import { affectsContractValue, canSendChangeOrder, canWithdrawChangeOrder, CLIENT_VISIBLE_STATUSES, validateSend } from "./change-orders";

// Noon Manila on 2026-10-12
const now = new Date("2026-10-12T04:00:00Z");
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const term = (over: Partial<TermInput> = {}): TermInput => ({
  status: "DUE",
  amount: 100_000,
  paid: 0,
  invoicedAt: null,
  certifiedAt: null,
  dueDate: null,
  ...over,
});

describe("paymentTermState", () => {
  it("is paid when status is PAID or payments cover the amount", () => {
    expect(paymentTermState(term({ status: "PAID" }), now).state).toBe("paid");
    expect(paymentTermState(term({ paid: 100_000 }), now)).toMatchObject({ state: "paid", outstanding: 0 });
  });

  it("an invoice is not cash: billed but unpaid is still outstanding", () => {
    const s = paymentTermState(term({ invoicedAt: d("2026-10-01"), dueDate: d("2026-10-31") }), now);
    expect(s).toMatchObject({ state: "billed", outstanding: 100_000 });
  });

  it("is overdue only with an invoice AND a past due date, and counts the days", () => {
    const s = paymentTermState(term({ invoicedAt: d("2026-09-01"), dueDate: d("2026-10-02") }), now);
    expect(s).toMatchObject({ state: "overdue", daysOverdue: 10 });
  });

  it("is not overdue on its due day", () => {
    expect(paymentTermState(term({ invoicedAt: d("2026-10-01"), dueDate: d("2026-10-12") }), now).state).toBe("billed");
  });

  it("never calls a bill overdue when no due date was entered", () => {
    expect(paymentTermState(term({ invoicedAt: d("2026-01-01") }), now).state).toBe("billed");
  });

  it("does not call an un-invoiced term overdue even if its date has passed", () => {
    expect(paymentTermState(term({ dueDate: d("2026-09-01") }), now).state).toBe("due-not-invoiced");
  });

  it("keeps an overdue partly-paid term overdue, with the unpaid remainder", () => {
    const s = paymentTermState(term({ paid: 40_000, invoicedAt: d("2026-09-01"), dueDate: d("2026-09-20") }), now);
    expect(s).toMatchObject({ state: "overdue", outstanding: 60_000 });
  });

  it("shows partial, due-not-invoiced and not-billed", () => {
    expect(paymentTermState(term({ paid: 10_000 }), now).state).toBe("partial");
    expect(paymentTermState(term(), now).state).toBe("due-not-invoiced");
    expect(paymentTermState(term({ status: "PENDING" }), now).state).toBe("not-billed");
  });

  it("records certification without changing what is owed", () => {
    const s = paymentTermState(term({ invoicedAt: d("2026-10-01"), certifiedAt: d("2026-10-05") }), now);
    expect(s.certified).toBe(true);
    expect(s.outstanding).toBe(100_000);
  });
});

describe("receivablesAging", () => {
  it("buckets overdue amounts by days past due and keeps unknowns separate", () => {
    const terms = [
      term({ amount: 10, invoicedAt: d("2026-09-01"), dueDate: d("2026-10-05") }), // 7 days
      term({ amount: 20, invoicedAt: d("2026-08-01"), dueDate: d("2026-09-01") }), // 41 days
      term({ amount: 30, invoicedAt: d("2026-06-01"), dueDate: d("2026-07-20") }), // 84 days
      term({ amount: 40, invoicedAt: d("2026-05-01"), dueDate: d("2026-06-01") }), // 133 days
      term({ amount: 50, invoicedAt: d("2026-10-01"), dueDate: d("2026-10-30") }), // not yet due
      term({ amount: 60, invoicedAt: d("2026-10-01") }), // no due date
      term({ amount: 70 }), // due, not invoiced
      term({ amount: 80, status: "PAID" }), // ignored
    ];
    expect(receivablesAging(terms, now)).toEqual({
      days1to30: 10,
      days31to60: 20,
      days61to90: 30,
      days90plus: 40,
      notYetDue: 50,
      noDueDate: 60,
      notInvoiced: 70,
      overdueTotal: 100,
      overdueCount: 4,
    });
  });

  it("returns zeros for no terms", () => {
    expect(receivablesAging([], now).overdueTotal).toBe(0);
  });
});

describe("retentionSchedule", () => {
  const r = (over: Record<string, unknown>) => ({ id: "r", label: "Retention", type: "RETENTION", status: "PENDING", amount: 50_000, paid: 0, retentionReleaseDate: null as Date | null, ...over });

  it("lists only unpaid retention, soonest release first, unknown dates last", () => {
    const rows = retentionSchedule(
      [
        r({ id: "none" }),
        r({ id: "later", retentionReleaseDate: d("2026-12-01") }),
        r({ id: "past", retentionReleaseDate: d("2026-10-01") }),
        r({ id: "paid", status: "PAID" }),
        { ...r({ id: "partial", paid: 20_000, retentionReleaseDate: d("2026-11-01") }) },
        { ...r({ id: "milestone", type: "PARTIAL" }) },
      ],
      now
    );
    expect(rows.map((x) => x.id)).toEqual(["past", "partial", "later", "none"]);
    expect(rows[0]).toMatchObject({ overdue: true, daysUntil: -11 });
    expect(rows[1].outstanding).toBe(30_000);
    expect(rows[3].overdue).toBeNull(); // no date: never called overdue
  });
});

describe("commitmentSummary", () => {
  it("does not count pending requisitions as commitments", () => {
    const s = commitmentSummary([
      { status: "SUBMITTED", estimatedCost: 50_000, po: null },
      { status: "UNDER_REVIEW", estimatedCost: 30_000, po: null },
    ]);
    expect(s.pending).toEqual({ count: 2, amount: 80_000 });
    expect(s.committedTotal).toBe(0);
  });

  it("commits approved requisitions at the estimate, and issued POs at the PO amount", () => {
    const s = commitmentSummary([
      { status: "APPROVED", estimatedCost: 10_000, po: null },
      { status: "PO_ISSUED", estimatedCost: 10_000, po: { totalCost: 12_500, status: "OPEN" } },
      { status: "DELIVERED", estimatedCost: 5_000, po: { totalCost: 4_800, status: "DELIVERED" } },
    ]);
    expect(s.approved.amount).toBe(10_000);
    expect(s.ordered.amount).toBe(12_500);
    expect(s.delivered.amount).toBe(4_800);
    expect(s.committedTotal).toBe(27_300);
  });

  it("commits nothing for a cancelled PO and flags approved requisitions with no estimate", () => {
    const s = commitmentSummary([
      { status: "PO_ISSUED", estimatedCost: 9_000, po: { totalCost: 9_000, status: "CANCELLED" } },
      { status: "APPROVED", estimatedCost: null, po: null },
      { status: "REJECTED", estimatedCost: 99_999, po: null },
    ]);
    expect(s.committedTotal).toBe(0);
    expect(s.approved.withoutEstimate).toBe(1);
    expect(s.rejected).toBe(1);
  });
});

describe("reconcileContract", () => {
  it("derives the original contract and keeps pending and potential changes out of the current value", () => {
    const r = reconcileContract({
      currentContract: 1_285_000,
      changeOrders: [
        { status: "APPROVED", costImpact: 185_000, estimatedCost: null },
        { status: "PENDING_CLIENT", costImpact: 50_000, estimatedCost: null },
        { status: "POTENTIAL", costImpact: 0, estimatedCost: 20_000 },
        { status: "POTENTIAL", costImpact: 0, estimatedCost: null },
        { status: "REJECTED", costImpact: 70_000, estimatedCost: null },
        { status: "WITHDRAWN", costImpact: 90_000, estimatedCost: null },
      ],
    });
    expect(r.original).toBe(1_100_000);
    expect(r).toMatchObject({ approvedCount: 1, approvedTotal: 185_000, pendingCount: 1, pendingTotal: 50_000, potentialCount: 2, potentialPricedTotal: 20_000, potentialUnpriced: 1, inconsistent: false });
  });

  it("flags approved changes that exceed the current contract value", () => {
    expect(reconcileContract({ currentContract: 100, changeOrders: [{ status: "APPROVED", costImpact: 500, estimatedCost: null }] }).inconsistent).toBe(true);
  });
});

describe("billingCoverage", () => {
  it("compares billing terms with the contract value", () => {
    expect(billingCoverage([400, 600], 1000).status).toBe("complete");
    expect(billingCoverage([400, 500], 1000)).toMatchObject({ status: "under", difference: 100 });
    expect(billingCoverage([700, 500], 1000).status).toBe("over");
    expect(billingCoverage([], 1000).status).toBe("none");
  });
});

describe("costFreshness", () => {
  it("reports no cost data rather than fresh, and stale beyond 30 days", () => {
    expect(costFreshness(null, now)).toEqual({ costAt: null, costAgeDays: null, costStale: false });
    expect(costFreshness(d("2026-10-10"), now).costStale).toBe(false);
    expect(costFreshness(d("2026-08-01"), now)).toMatchObject({ costStale: true });
  });
});

describe("change order lifecycle rules", () => {
  it("only a potential change can be sent; only open ones can be withdrawn", () => {
    expect(canSendChangeOrder("POTENTIAL")).toBe(true);
    for (const s of ["PENDING_CLIENT", "APPROVED", "REJECTED", "WITHDRAWN"] as const) expect(canSendChangeOrder(s)).toBe(false);
    expect(canWithdrawChangeOrder("PENDING_CLIENT")).toBe(true);
    expect(canWithdrawChangeOrder("POTENTIAL")).toBe(true);
    expect(canWithdrawChangeOrder("APPROVED")).toBe(false);
    expect(canWithdrawChangeOrder("REJECTED")).toBe(false);
  });

  it("only approved changes touch the contract value", () => {
    expect(affectsContractValue("APPROVED")).toBe(true);
    for (const s of ["POTENTIAL", "PENDING_CLIENT", "REJECTED", "WITHDRAWN"] as const) expect(affectsContractValue(s)).toBe(false);
  });

  it("never shows internal statuses to a client", () => {
    expect(CLIENT_VISIBLE_STATUSES).not.toContain("POTENTIAL");
    expect(CLIENT_VISIBLE_STATUSES).not.toContain("WITHDRAWN");
  });

  it("requires an explicit price and time to send", () => {
    expect(validateSend({ costImpact: null, timeImpactDays: 3 })).toMatch(/cost/i);
    expect(validateSend({ costImpact: 1000, timeImpactDays: null })).toMatch(/time/i);
    expect(validateSend({ costImpact: 0, timeImpactDays: 0 })).toBeNull();
  });
});
