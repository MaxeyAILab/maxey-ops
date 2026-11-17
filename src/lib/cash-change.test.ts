import { describe, expect, it } from "vitest";
import { canConfirmChange, changeDue } from "./cash-expense";

const req = { requestedById: "zoilo", releasedByName: "Vanie Rose A. Labe" };

describe("petty cash change handed back", () => {
  it("is the released amount less what was spent, once expenses are reported", () => {
    expect(changeDue({ status: "FOR_LIQUIDATION", amount: 3000, spentAmount: 223 })).toBe(2777);
    expect(changeDue({ status: "LIQUIDATED", amount: "100", spentAmount: "0" })).toBe(100);
    expect(changeDue({ status: "LIQUIDATED", amount: 450, spentAmount: 500 })).toBe(0); // overspent: reimbursed, no change
    expect(changeDue({ status: "RELEASED", amount: 500, spentAmount: null })).toBe(0); // not reported yet
  });

  it("is confirmed by the person who released the cash, anyone switched on, or the Owner — never the one returning it", () => {
    expect(canConfirmChange({ id: "v", name: "Vanie Rose A. Labe", role: "OFFICE" }, req)).toBe(true);
    expect(canConfirmChange({ id: "f", name: "Felisa Villamor", role: "OFFICE", receivesChange: true }, req)).toBe(true);
    expect(canConfirmChange({ id: "j", name: "Jacob B. Villamor", role: "OWNER" }, req)).toBe(true);
    expect(canConfirmChange({ id: "a", name: "Arlene L. Simon", role: "PURCHASING" }, req)).toBe(false);
    expect(canConfirmChange({ id: "zoilo", name: "Zoilo Vallestero", role: "OFFICE", receivesChange: true }, req)).toBe(false);
  });
});
