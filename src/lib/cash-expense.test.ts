import { describe, expect, it } from "vitest";
import {
  advanceBalance,
  allocateDeduction,
  canAttachReceipts,
  cashOut,
  formatCashAdvanceNo,
  formatPettyCashNo,
  fundBalance,
  liquidationReturn,
  missingReceipt,
  plannedDeduction,
  postedExpense,
  receiptCount,
  unliquidated,
} from "@/lib/cash-expense";

const req = (status: string, amount: number, spentAmount?: number) => ({ status, amount, spentAmount });
const adv = (id: string, amount: number, per: number, deducted: number, day: number) => ({
  id,
  amount,
  deductionPerCutoff: per,
  deducted,
  createdAt: new Date(Date.UTC(2026, 9, day)),
});

describe("petty cash fund", () => {
  it("numbers requests and advances", () => {
    expect(formatPettyCashNo(7)).toBe("PC-0007");
    expect(formatCashAdvanceNo(123)).toBe("CA-0123");
  });

  it("only released requests take cash out of the fund", () => {
    expect(cashOut(req("PENDING", 500))).toBe(0);
    expect(cashOut(req("APPROVED", 500))).toBe(0);
    expect(cashOut(req("RELEASED", 500))).toBe(500);
    expect(cashOut(req("FOR_LIQUIDATION", 500))).toBe(500);
    expect(cashOut(req("LIQUIDATED", 500, 420))).toBe(500);
    expect(cashOut(req("REJECTED", 500))).toBe(0);
  });

  it("a verified liquidation returns the change, or reimburses an overspend", () => {
    expect(liquidationReturn(req("LIQUIDATED", 1000, 870.5))).toBe(129.5);
    expect(liquidationReturn(req("LIQUIDATED", 1000, 1100))).toBe(-100);
    expect(liquidationReturn(req("FOR_LIQUIDATION", 1000, 870))).toBe(0);
  });

  it("posts the spent amount as the expense only once verified", () => {
    expect(postedExpense(req("FOR_LIQUIDATION", 1000, 870))).toBe(0);
    expect(postedExpense(req("LIQUIDATED", 1000, 870))).toBe(870);
  });

  it("counts released-but-unverified cash as unliquidated", () => {
    expect(unliquidated(req("RELEASED", 300))).toBe(300);
    expect(unliquidated(req("FOR_LIQUIDATION", 300, 280))).toBe(300);
    expect(unliquidated(req("LIQUIDATED", 300, 280))).toBe(0);
  });

  it("works out the running balance", () => {
    const fund = [{ amount: 50000 }, { amount: -200 }];
    const requests = [
      req("PENDING", 1250), // not out yet
      req("RELEASED", 2800), // out
      req("LIQUIDATED", 1000, 760), // out 1000, 240 back
      req("REJECTED", 999),
    ];
    expect(fundBalance(fund, requests)).toBe(50000 - 200 - 2800 - 1000 + 240);
  });
});

describe("cash advances", () => {
  it("balance never goes below zero", () => {
    expect(advanceBalance({ amount: 5000, deducted: 1500 })).toBe(3500);
    expect(advanceBalance({ amount: 5000, deducted: 6000 })).toBe(0);
  });

  it("plans one cut-off's deduction from each active advance, capped at its balance", () => {
    expect(plannedDeduction([adv("a", 5000, 1000, 0, 1)])).toBe(1000);
    expect(plannedDeduction([adv("a", 5000, 1000, 4500, 1)])).toBe(500);
    expect(plannedDeduction([adv("a", 5000, 1000, 0, 1), adv("b", 2000, 500, 0, 5)])).toBe(1500);
  });

  it("doesn't double-deduct when another open run already plans part of the balance", () => {
    // 1,500 left; another open run already takes 1,000 → only 500 is left to plan
    expect(plannedDeduction([adv("a", 3000, 1000, 1500, 1)], 1000)).toBe(500);
    expect(plannedDeduction([adv("a", 3000, 1000, 1500, 1)], 1500)).toBe(0);
  });

  it("allocates an approved deduction oldest advance first", () => {
    const advances = [adv("new", 2000, 500, 0, 9), adv("old", 1000, 500, 800, 1)];
    expect(allocateDeduction(700, advances)).toEqual([
      { advanceId: "old", amount: 200 },
      { advanceId: "new", amount: 500 },
    ]);
  });

  it("never posts more than the balances", () => {
    expect(allocateDeduction(5000, [adv("a", 1000, 500, 0, 1)])).toEqual([{ advanceId: "a", amount: 1000 }]);
    expect(allocateDeduction(0, [adv("a", 1000, 500, 0, 1)])).toEqual([]);
  });
});

describe("who handles petty cash", () => {
  it("the Owner approves and releases; others only when switched on", async () => {
    const { canApprovePettyCash, canReleasePettyCash, seesAllPettyCash } = await import("@/lib/cash-expense");
    expect(canApprovePettyCash({ role: "OWNER" })).toBe(true);
    expect(canApprovePettyCash({ role: "OFFICE" })).toBe(false);
    expect(canApprovePettyCash({ role: "OFFICE", canApprovePettyCash: true })).toBe(true);
    expect(canApprovePettyCash({ role: "ACCOUNTING" })).toBe(false);
    expect(canReleasePettyCash({ role: "ACCOUNTING" })).toBe(false);
    expect(canReleasePettyCash({ role: "OFFICE", canReleasePettyCash: true })).toBe(true);
    expect(canReleasePettyCash({ role: "OWNER" })).toBe(true);
    expect(seesAllPettyCash({ role: "PM" })).toBe(false);
    expect(seesAllPettyCash({ role: "OFFICE", canReleasePettyCash: true })).toBe(true);
    expect(seesAllPettyCash({ role: "ACCOUNTING" })).toBe(true);
  });

  it("full Cash Expense access makes a non-Accounting person a custodian, without approving", async () => {
    const { isCashCustodian, canApprovePettyCash, seesAllPettyCash } = await import("@/lib/cash-expense");
    const { canUseCashExpense } = await import("@/lib/access");
    const arlene = { role: "PURCHASING" as const, department: "OFFICE" as const, canManageCash: true };
    expect(isCashCustodian(arlene)).toBe(true);
    expect(seesAllPettyCash(arlene)).toBe(true);
    expect(canApprovePettyCash(arlene)).toBe(false);
    expect(canUseCashExpense(arlene)).toBe(true);
    expect(isCashCustodian({ role: "PURCHASING" })).toBe(false);
  });

  it("every staff account has the Cash Expense tab; office staff see everyone's records, site and drivers their own", async () => {
    const { canUseCashExpense } = await import("@/lib/access");
    const { seesAllPettyCash, isCashCustodian } = await import("@/lib/cash-expense");
    expect(canUseCashExpense({ role: "OFFICE" })).toBe(true);
    expect(canUseCashExpense({ role: "DRIVER" })).toBe(true);
    expect(canUseCashExpense({ role: "CLIENT" })).toBe(false);
    expect(seesAllPettyCash({ role: "OFFICE", department: "OFFICE" })).toBe(true);
    expect(seesAllPettyCash({ role: "OFFICE", department: "ENGINEER" })).toBe(true);
    expect(seesAllPettyCash({ role: "OFFICE", department: "SITE" })).toBe(false);
    expect(seesAllPettyCash({ role: "FOREMAN", department: "SITE" })).toBe(false);
    expect(seesAllPettyCash({ role: "DRIVER", department: "DRIVER" })).toBe(false);
    expect(seesAllPettyCash({ role: "DRIVER", department: "OFFICE" })).toBe(false);
    // seeing everyone's records isn't managing them
    expect(isCashCustodian({ role: "OFFICE" })).toBe(false);
  });
});

describe("receipts on a liquidation", () => {
  it("counts the receipt photos", () => {
    expect(receiptCount({ liquidationReceipts: ["a.jpg", "b.jpg"] })).toBe(2);
    expect(receiptCount({ liquidationReceipts: [] })).toBe(0);
    expect(receiptCount({ liquidationReceipts: null })).toBe(0);
    expect(receiptCount({})).toBe(0);
  });

  it("flags a liquidation that was turned in with no receipt — waiting or already posted", () => {
    expect(missingReceipt({ status: "FOR_LIQUIDATION", liquidationReceipts: null })).toBe(true);
    expect(missingReceipt({ status: "LIQUIDATED", liquidationReceipts: [] })).toBe(true);
  });

  it("does not flag one with a receipt, or one that has not been turned in yet", () => {
    expect(missingReceipt({ status: "FOR_LIQUIDATION", liquidationReceipts: ["a.jpg"] })).toBe(false);
    expect(missingReceipt({ status: "LIQUIDATED", liquidationReceipts: ["a.jpg"] })).toBe(false);
    for (const status of ["PENDING", "APPROVED", "RELEASED", "REJECTED", "CANCELLED"]) expect(missingReceipt({ status, liquidationReceipts: null }), status).toBe(false);
  });

  it("lets the requester, whoever filed it, and the cash custodians attach receipts — nobody else", () => {
    const r = { requestedById: "req", createdById: "clerk" };
    expect(canAttachReceipts({ id: "req", role: "OFFICE" }, r)).toBe(true);
    expect(canAttachReceipts({ id: "clerk", role: "OFFICE" }, r)).toBe(true);
    expect(canAttachReceipts({ id: "x", role: "OWNER" }, r)).toBe(true);
    expect(canAttachReceipts({ id: "x", role: "ACCOUNTING" }, r)).toBe(true);
    expect(canAttachReceipts({ id: "x", role: "OFFICE", canManageCash: true }, r)).toBe(true);
    expect(canAttachReceipts({ id: "x", role: "OFFICE" }, r)).toBe(false);
    expect(canAttachReceipts({ id: "x", role: "FOREMAN" }, r)).toBe(false);
  });
});
