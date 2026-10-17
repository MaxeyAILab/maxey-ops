import { describe, expect, it } from "vitest";
import { canRaiseRequisition, requisitionAllowedByRole } from "./requisitions";

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
