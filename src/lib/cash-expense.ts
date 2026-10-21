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

/**
 * Owner and Accounting run the fund — and anyone the Owner gave full Cash Expense access: they see every request, file
 * for anyone, top up the fund, verify liquidations and handle cash advances.
 */
export function isCashCustodian(u: { role: string; canManageCash?: boolean | null }): boolean {
  return u.role === "OWNER" || u.role === "ACCOUNTING" || !!u.canManageCash;
}

/** Owner-only: approving a cash advance, deleting released petty cash. */
export function canApproveCash(u: { role: string }): boolean {
  return u.role === "OWNER";
}

type CashPerson = {
  role: string;
  department?: string | null;
  canApprovePettyCash?: boolean | null;
  canReleasePettyCash?: boolean | null;
  canManageCash?: boolean | null;
};

/** Office staff (Office, Architect, Engineer departments) — as opposed to site workers and drivers. */
export function isOfficeStaff(u: { role: string; department?: string | null }): boolean {
  if (u.role === "CLIENT" || u.role === "DRIVER") return false;
  return u.department === "OFFICE" || u.department === "ARCHITECT" || u.department === "ENGINEER";
}

/** Approves (or rejects, or calls off an approval of) a petty cash request: the Owner and whoever the Owner switched on. */
export function canApprovePettyCash(u: CashPerson): boolean {
  return u.role === "OWNER" || !!u.canApprovePettyCash;
}

/** Confirms handing out approved petty cash: whoever the Owner switched on (the Owner always can). */
export function canReleasePettyCash(u: CashPerson): boolean {
  return u.role === "OWNER" || !!u.canReleasePettyCash;
}

/**
 * Sees everyone's Cash Expense records (every petty cash request, every cash advance, the full report) rather than
 * just their own: office staff, plus the custodians, approvers and releasers. Site workers and drivers see their own.
 * Seeing isn't managing — the fund, verification and cash advances stay with the custodians.
 */
export function seesAllPettyCash(u: CashPerson): boolean {
  return isOfficeStaff(u) || isCashCustodian(u) || canApprovePettyCash(u) || canReleasePettyCash(u);
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

/** The most receipt photos one liquidation can hold, counting those added later. */
export const MAX_LIQUIDATION_RECEIPTS = 12;

/** How many receipt photos a liquidation has. */
export function receiptCount(r: { liquidationReceipts?: unknown }): number {
  return Array.isArray(r.liquidationReceipts) ? r.liquidationReceipts.length : 0;
}

/**
 * A liquidation that was turned in (waiting for verification, or already verified and posted) with no receipt attached.
 * These are flagged for the Owner and Accounting until somebody attaches one.
 */
export function missingReceipt(r: { status: string; liquidationReceipts?: unknown }): boolean {
  return (r.status === "FOR_LIQUIDATION" || r.status === "LIQUIDATED") && receiptCount(r) === 0;
}

/** Who may add receipts to a liquidation after it was submitted: the person it is for, whoever typed it in, and the cash custodians. */
export function canAttachReceipts(u: { id: string; role: string; canManageCash?: boolean | null }, r: { requestedById: string; createdById: string }): boolean {
  return r.requestedById === u.id || r.createdById === u.id || isCashCustodian(u);
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

/**
 * What the Owner is told before deleting a cash advance, so nothing is a surprise: whether money is still owed on it, what was
 * repaid, and that payslips already issued keep showing their deduction.
 */
export function advanceDeleteWarning(a: { no: string; employee: string; status: string; amount: number; repaid: number; balance: number; repayments: number; issuedPayslipRepayments: number }, money: (n: number) => string): string {
  const lines = [`Delete ${a.no} (${money(a.amount)}, ${a.employee})?`];
  if (a.status === "ACTIVE" && a.balance > 0) lines.push(`⚠ ${money(a.balance)} is still owed on it. Deleting it means no more will be taken from payroll.`);
  if (a.repayments > 0) lines.push(`This also removes its ${a.repayments} repayment record${a.repayments === 1 ? "" : "s"} (${money(a.repaid)} repaid).`);
  if (a.issuedPayslipRepayments > 0) lines.push("Payroll runs already approved keep their payslips and deductions exactly as they are.");
  if (a.status === "ACTIVE") lines.push("A payroll run that is still a draft may already have this deduction filled in — check it before approving.");
  lines.push("This can't be undone (the audit log keeps a full record).");
  return lines.join("\n\n");
}

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
