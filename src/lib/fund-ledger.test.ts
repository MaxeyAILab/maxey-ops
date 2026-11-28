import { describe, expect, it } from "vitest";
import { fundBalance } from "./cash-expense";
import { fundLedger, fundNoteProblem, ledgerTotals } from "./fund-ledger";

const at = (s: string) => new Date(`${s}+08:00`);
const entry = (id: string, when: string, amount: number) => ({ id, createdAt: at(when), amount });
// a request released Nov 10 for 3,000 that spent 2,500 and was verified Nov 12 (500 change goes back to the fund)
const verified = { status: "LIQUIDATED", amount: 3000, spentAmount: 2500, releasedAt: at("2026-11-10T10:00"), liquidatedAt: at("2026-11-12T10:00") };
const releasedOnly = { status: "RELEASED", amount: 1000, spentAmount: null, releasedAt: at("2026-11-11T09:00"), liquidatedAt: null };
const waiting = { status: "PENDING", amount: 800, spentAmount: null, releasedAt: null, liquidatedAt: null };

describe("fund entry note", () => {
  it("is required: where the cash came from, or why it is corrected", () => {
    expect(fundNoteProblem("Check #1023 encashed")).toBeNull();
    expect(fundNoteProblem("  EJBV  ")).toBeNull();
    expect(fundNoteProblem(undefined)).toMatch(/where the cash came from/);
    expect(fundNoteProblem(null)).not.toBeNull();
    expect(fundNoteProblem("")).not.toBeNull();
    expect(fundNoteProblem("   ")).not.toBeNull();
    expect(fundNoteProblem("ab")).not.toBeNull();
  });
});

describe("fund replenishment trail", () => {
  const entries = [entry("b", "2026-11-11T08:00", 5000), entry("a", "2026-11-01T08:00", 10000), entry("c", "2026-11-13T08:00", 2000)];
  const requests = [verified, releasedOnly, waiting];

  it("numbers entries oldest first and tells what each put in", () => {
    const { rows } = fundLedger(entries, requests);
    expect(rows.map((r) => [r.entry.id, r.no, r.amount, r.kind])).toEqual([["a", 1, 10000, "added"], ["b", 2, 5000, "added"], ["c", 3, 2000, "added"]]);
  });

  it("works out the cash in the fund right after each entry, releases and returned change included", () => {
    const { rows, reconciled } = fundLedger(entries, requests);
    expect(reconciled).toBe(true);
    // Nov 1: 10,000 · Nov 11 08:00: +5,000 − 3,000 released Nov 10 = 12,000 (the 1,000 released at 09:00 is later) · Nov 13: +2,000 − 1,000 + 500 change = 13,500
    expect(rows.map((r) => r.balanceAfter)).toEqual([10000, 12000, 13500]);
    expect(rows[rows.length - 1].balanceAfter).toBe(fundBalance(entries, requests));
  });

  it("shows a correction (negative) as a correction", () => {
    const { rows } = fundLedger([entry("a", "2026-11-01T08:00", 1000), entry("b", "2026-11-02T08:00", -250)], []);
    expect(rows.map((r) => [r.kind, r.amount, r.balanceAfter])).toEqual([["added", 1000, 1000], ["correction", -250, 750]]);
  });

  it("hides the balances rather than show a wrong one when a release can't be placed in time", () => {
    const noTime = { status: "RELEASED", amount: 700, spentAmount: null, releasedAt: null, liquidatedAt: null };
    const { rows, reconciled } = fundLedger(entries, [noTime]);
    expect(reconciled).toBe(false);
    expect(rows.every((r) => r.balanceAfter === null)).toBe(true);
  });

  it("is fine with no entries", () => {
    expect(fundLedger([], requests).rows).toEqual([]);
  });

  it("totals replenishments and corrections separately", () => {
    const { rows } = fundLedger([entry("a", "2026-11-01T08:00", 1000), entry("b", "2026-11-02T08:00", 500), entry("c", "2026-11-03T08:00", -250)], []);
    expect(ledgerTotals(rows)).toEqual({ added: 1500, corrections: -250, net: 1250, addedCount: 2, correctionCount: 1 });
  });
});
