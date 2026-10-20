import { describe, expect, it } from "vitest";
import { CASH_TAB, defaultTabs, resolveTabs, tabTarget } from "./mobile-tabs";

const purchasingMenus = ["/projects", "/requisitions", "/purchasing", "/deliveries", "/inventory", "/instructions", "/attendance", "/payroll", CASH_TAB];

describe("bottom bar tabs", () => {
  it("gives purchasing and accounting staff requisitions, purchasing, deliveries, attendance and cash expense", () => {
    expect(defaultTabs("PURCHASING", purchasingMenus)).toEqual(["/requisitions", "/purchasing", "/deliveries", "/attendance", CASH_TAB]);
  });

  it("puts projects first for a foreman and never offers a tab they can't open", () => {
    const foreman = ["/projects", "/requisitions", "/deliveries", "/instructions", "/attendance", CASH_TAB];
    expect(defaultTabs("FOREMAN", foreman)).toEqual(["/projects", "/requisitions", "/deliveries", "/attendance", CASH_TAB]);
  });

  it("gives office staff the few tabs they have", () => {
    expect(defaultTabs("OFFICE", ["/instructions", "/attendance", "/payroll", CASH_TAB])).toEqual(["/attendance", "/instructions", "/payroll", CASH_TAB]);
  });

  it("starts the Owner on the dashboard", () => {
    const owner = ["/dashboard", "/finance", "/leads", "/projects", "/requisitions", "/purchasing", "/deliveries", "/inventory", "/instructions", "/attendance", "/payroll", CASH_TAB, "/people"];
    expect(defaultTabs("OWNER", owner)).toEqual(["/dashboard", "/requisitions", "/purchasing", "/deliveries", CASH_TAB]);
  });

  it("fills up to five from what's available when the preferred ones are missing", () => {
    expect(defaultTabs("OFFICE", ["/inventory", "/instructions", "/people"])).toEqual(["/instructions", "/inventory", "/people"]);
  });

  it("uses the person's own choice, in their order", () => {
    expect(resolveTabs(["/payroll", "/attendance", CASH_TAB], "PURCHASING", purchasingMenus)).toEqual(["/payroll", "/attendance", CASH_TAB]);
  });

  it("drops tabs the person has lost access to, and falls back to the default when too few remain", () => {
    expect(resolveTabs(["/finance", "/attendance", "/payroll"], "PURCHASING", purchasingMenus)).toEqual(["/attendance", "/payroll"]);
    expect(resolveTabs(["/finance", "/attendance"], "PURCHASING", purchasingMenus)).toEqual(defaultTabs("PURCHASING", purchasingMenus));
    expect(resolveTabs([], "PURCHASING", purchasingMenus)).toEqual(defaultTabs("PURCHASING", purchasingMenus));
    expect(resolveTabs(null, "PURCHASING", purchasingMenus)).toEqual(defaultTabs("PURCHASING", purchasingMenus));
  });

  it("caps a choice at five and ignores repeats", () => {
    expect(resolveTabs(["/projects", "/projects", "/requisitions", "/purchasing", "/deliveries", "/inventory", "/payroll"], "PURCHASING", purchasingMenus)).toHaveLength(5);
  });

  it("opens Cash Expense on its first page", () => {
    expect(tabTarget(CASH_TAB)).toBe("/cash-expense/petty-cash");
    expect(tabTarget("/payroll")).toBe("/payroll");
  });
});
