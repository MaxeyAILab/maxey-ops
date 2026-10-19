/**
 * Cash Expense (Finance): petty cash requests, their liquidation, and workers' cash advances. Pure rules only — the
 * pages, the API and the payroll hooks all use these, so a balance or a deduction is never worked out two ways.
 */

export const PETTY_CASH_CATEGORIES = [
  { value: "SITE_SUPPLIES", label: "Site Supplies" },
  { value: "FUEL", label: "Fuel" },
  { value: "MEALS", label: "Meals" },
  { value: "TRANSPORTATION", label: "Transportation" },
  { value: "TOOLS_EQUIPMENT", label: "Tools & Equipment" },
  { value: "REPAIRS_MAINTENANCE", label: "Repairs & Maintenance" },
  { value: "OFFICE_SUPPLIES", label: "Office Supplies" },
  { value: "PERMITS_FEES", label: "Permits & Fees" },
  { value: "UTILITIES", label: "Utilities" },
  { value: "OTHER", label: "Other" },
] as const;

export const PETTY_CASH_CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  PETTY_CASH_CATEGORIES.map((c) => [c.value, c.label])
);

export const PETTY_CASH_STATUS_LABEL: Record<string, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  RELEASED: "Released",
  FOR_LIQUIDATION: "For liquidation",
  LIQUIDATED: "Liquidated",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

export const CASH_ADVANCE_STATUS_LABEL: Record<string, string> = {
  PENDING: "Pending",
  ACTIVE: "Deducting",
  PAID: "Fully paid",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

/** Label shown wherever a petty cash request's project goes — "General & Administrative" when it has none. */
export const NO_PROJECT_LABEL = "General & Administrative";

/** Select value standing for "no project" in forms — a required select can't use an empty value. */
export const NO_PROJECT = "__none";

export const formatPettyCashNo = (n: number) => `PC-${String(n).padStart(4, "0")}`;
export const formatCashAdvanceNo = (n: number) => `CA-${String(n).padStart(4, "0")}`;

/** Owner and Accounting run the fund: they see every request, file for anyone, release cash and verify liquidations. */
export function isCashCustodian(u: { role: string }): boolean {
  return u.role === "OWNER" || u.role === "ACCOUNTING";
}

/** Only the Owner approves a petty cash request or a cash advance. */
export function canApproveCash(u: { role: string }): boolean {
  return u.role === "OWNER";
}

const r2 = (n: number) => Math.round(n * 100) / 100;

type Money = number | string | { toString(): string } | null | undefined;
const num = (m: Money) => (m == null ? 0 : Number(m.toString()));

const OUT_OF_FUND = new Set(["RELEASED", "FOR_LIQUIDATION", "LIQUIDATED"]);

export interface PettyCashLike {
  status: string;
  amount: Money;
  spentAmount?: Money;
}

/** Cash that left the fund for a request: the released amount, from release on. */
export function cashOut(r: PettyCashLike): number {
  return OUT_OF_FUND.has(r.status) ? num(r.amount) : 0;
}

/**
 * What a verified liquidation puts back in the fund: unspent change (+), or — when more was spent than released —
 * the shortfall reimbursed to the requester (−). Nothing until it's verified.
 */
export function liquidationReturn(r: PettyCashLike): number {
  return r.status === "LIQUIDATED" ? r2(num(r.amount) - num(r.spentAmount)) : 0;
}

/** The cost a request posts once its liquidation is verified: what was really spent. */
export function postedExpense(r: PettyCashLike): number {
  return r.status === "LIQUIDATED" ? num(r.spentAmount) : 0;
}

/** Released cash not yet verified — money out in people's hands, still owed receipts. */
export function unliquidated(r: PettyCashLike): number {
  return r.status === "RELEASED" || r.status === "FOR_LIQUIDATION" ? num(r.amount) : 0;
}

/** Cash in the fund now: replenishments and corrections, less cash released, plus change returned at liquidation. */
export function fundBalance(fundEntries: { amount: Money }[], requests: PettyCashLike[]): number {
  const funded = fundEntries.reduce((s, e) => s + num(e.amount), 0);
  const moved = requests.reduce((s, r) => s - cashOut(r) + liquidationReturn(r), 0);
  return r2(funded + moved);
}

/** Total of liquidation line items, to the centavo. */
export function itemsTotal(items: { amount: number }[]): number {
  return r2(items.reduce((s, i) => s + i.amount, 0));
}

// ---------- Cash advances ----------

export interface AdvanceLike {
  id: string;
  amount: Money;
  deductionPerCutoff: Money;
  createdAt: Date;
  deducted: number; // already repaid (payroll deductions + cash payments)
}

export function advanceBalance(a: { amount: Money; deducted: number }): number {
  return Math.max(0, r2(num(a.amount) - a.deducted));
}

/**
 * The cash-advance deduction a new payroll run should start with for one person: each active advance's per-cut-off
 * amount, never more than what's left on it after deductions already sitting in other open (not yet approved) runs.
 */
export function plannedDeduction(advances: AdvanceLike[], alreadyPlanned = 0): number {
  let left = Math.max(0, alreadyPlanned);
  let total = 0;
  for (const a of [...advances].sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime())) {
    let room = advanceBalance(a);
    const used = Math.min(room, left); // other open runs already claim this much of the balance
    left -= used;
    room -= used;
    total += Math.min(num(a.deductionPerCutoff), room);
  }
  return r2(total);
}

/**
 * Splits the cash-advance deduction on an approved payslip across that person's advances, oldest first, never past
 * an advance's balance. Anything beyond every balance isn't posted to an advance (it stays on the payslip as entered).
 */
export function allocateDeduction(total: number, advances: AdvanceLike[]): { advanceId: string; amount: number }[] {
  let left = r2(Math.max(0, total));
  const out: { advanceId: string; amount: number }[] = [];
  for (const a of [...advances].sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime())) {
    if (left <= 0) break;
    const take = r2(Math.min(left, advanceBalance(a)));
    if (take > 0) {
      out.push({ advanceId: a.id, amount: take });
      left = r2(left - take);
    }
  }
  return out;
}
