import { describe, expect, it } from "vitest";
import { hasCashOwnerPowers, hasInventoryOwnerPowers } from "./owner-authority";
import { canApproveCash, canApprovePettyCash, canReleasePettyCash, isCashCustodian, seesAllPettyCash } from "./cash-expense";
import { canDeleteTool } from "./access";

describe("owner authority switches", () => {
  it("the Owner always has both", () => {
    expect(hasInventoryOwnerPowers({ role: "OWNER" })).toBe(true);
    expect(hasCashOwnerPowers({ role: "OWNER" })).toBe(true);
  });
  it("others only with the switch, and each switch is separate", () => {
    expect(hasInventoryOwnerPowers({ role: "PM" })).toBe(false);
    expect(hasCashOwnerPowers({ role: "PM" })).toBe(false);
    expect(hasInventoryOwnerPowers({ role: "PM", ownerInventory: true })).toBe(true);
    expect(hasCashOwnerPowers({ role: "PM", ownerInventory: true })).toBe(false);
    expect(hasInventoryOwnerPowers({ role: "PM", ownerCash: true })).toBe(false);
    expect(hasCashOwnerPowers({ role: "PM", ownerCash: true })).toBe(true);
  });
});

describe("the cash switch opens every Cash Expense power", () => {
  const joseph = { role: "PM", department: "OFFICE", ownerCash: true };
  const pm = { role: "PM", department: "OFFICE" };
  it("grants approve, release, fund, advances and deletes", () => {
    expect(canApprovePettyCash(joseph)).toBe(true);
    expect(canReleasePettyCash(joseph)).toBe(true);
    expect(isCashCustodian(joseph)).toBe(true);
    expect(canApproveCash(joseph)).toBe(true);
    expect(seesAllPettyCash(joseph)).toBe(true);
  });
  it("does not grant them without it", () => {
    expect(canApprovePettyCash(pm)).toBe(false);
    expect(canReleasePettyCash(pm)).toBe(false);
    expect(isCashCustodian(pm)).toBe(false);
    expect(canApproveCash(pm)).toBe(false);
  });
});

describe("inventory switch and tools", () => {
  it("lets the switch holder delete a tool that has history", () => {
    expect(canDeleteTool({ role: "PM", ownerInventory: true } as never, 5)).toBe(true);
    expect(canDeleteTool({ role: "PM" } as never, 5)).toBe(false);
  });
});
