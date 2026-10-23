import { describe, expect, it } from "vitest";
import { canRaiseRequisition, requisitionAllowedByRole, seesOnlyOwnRequisitions } from "./requisitions";
import { withOwnRequisitionsTab } from "./access";

describe("who may raise a requisition", () => {
  it("allows Foremen, PMs, the Owner and drivers by role", () => {
    for (const role of ["FOREMAN", "PM", "OWNER", "DRIVER"]) expect(canRaiseRequisition({ role })).toBe(true);
  });

  it("allows Architect and Engineer departments whatever their role", () => {
    expect(canRaiseRequisition({ role: "OFFICE", department: "ARCHITECT" })).toBe(true);
    expect(canRaiseRequisition({ role: "OFFICE", department: "ENGINEER" })).toBe(true);
  });

  it("does not allow Purchasing, Accounting or plain office staff on their own", () => {
    for (const role of ["PURCHASING", "ACCOUNTING", "OFFICE"]) expect(canRaiseRequisition({ role, department: "OFFICE" })).toBe(false);
  });

  it("lets the Owner switch it on for one person", () => {
    expect(canRaiseRequisition({ role: "PURCHASING", department: "OFFICE", canRequisition: true })).toBe(true);
    expect(canRaiseRequisition({ role: "OFFICE", department: "OFFICE", canRequisition: true })).toBe(true);
    expect(canRaiseRequisition({ role: "PURCHASING", department: "OFFICE", canRequisition: false })).toBe(false);
  });

  it("never allows a client, even with the switch", () => {
    expect(canRaiseRequisition({ role: "CLIENT", canRequisition: true })).toBe(false);
    expect(canRaiseRequisition({ role: "CLIENT", department: "ENGINEER" })).toBe(false);
  });

  it("tells the People page when the switch isn't needed", () => {
    expect(requisitionAllowedByRole({ role: "FOREMAN" })).toBe(true);
    expect(requisitionAllowedByRole({ role: "PURCHASING", department: "OFFICE" })).toBe(false);
  });
});

describe("who sees only their own requisitions", () => {
  it("is every Foreman, and anyone the Owner switched it on for", () => {
    expect(seesOnlyOwnRequisitions({ role: "FOREMAN" })).toBe(true);
    expect(seesOnlyOwnRequisitions({ role: "OFFICE", ownRequisitionsOnly: true })).toBe(true);
  });

  it("is nobody else — office staff, PM, Purchasing and Accounting still see all by default", () => {
    for (const role of ["OFFICE", "PM", "PURCHASING", "ACCOUNTING", "DRIVER", "OWNER"]) expect(seesOnlyOwnRequisitions({ role })).toBe(false);
    expect(seesOnlyOwnRequisitions({ role: "OFFICE", ownRequisitionsOnly: false })).toBe(false);
  });
});

describe("the Requisitions tab for someone limited to their own", () => {
  const painter = { role: "OFFICE" as const, department: "SITE" as const, useCustomMenus: true, customMenus: ["/instructions", "/attendance", "/payroll"] };

  it("is added automatically, keeping the tabs they already have", () => {
    const r = withOwnRequisitionsTab({ ...painter, ownRequisitionsOnly: true });
    expect(r.useCustomMenus).toBe(true);
    expect(r.customMenus).toEqual(["/instructions", "/attendance", "/payroll", "/requisitions"]);
  });

  it("works for someone on their role's standard tabs too", () => {
    const r = withOwnRequisitionsTab({ ...painter, useCustomMenus: false, customMenus: [], ownRequisitionsOnly: true });
    expect(r.useCustomMenus).toBe(true);
    expect(r.customMenus).toContain("/requisitions");
    expect(r.customMenus).toContain("/attendance");
  });

  it("changes nothing for anyone without the switch, or who already has the tab", () => {
    expect(withOwnRequisitionsTab({ ...painter, ownRequisitionsOnly: false })).toEqual({ useCustomMenus: true, customMenus: painter.customMenus });
    expect(withOwnRequisitionsTab({ ...painter, customMenus: ["/requisitions", "/attendance"], ownRequisitionsOnly: true }).customMenus).toEqual(["/requisitions", "/attendance"]);
    expect(withOwnRequisitionsTab({ role: "FOREMAN", department: "SITE", useCustomMenus: false, customMenus: [], ownRequisitionsOnly: true }).useCustomMenus).toBe(false);
  });

  it("never gives a client a tab", () => {
    expect(withOwnRequisitionsTab({ role: "CLIENT", department: null, useCustomMenus: false, customMenus: [], ownRequisitionsOnly: true }).customMenus).toEqual([]);
  });
});
