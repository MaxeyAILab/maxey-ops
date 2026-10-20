import { describe, expect, it } from "vitest";
import { DEFAULT_QUICK, MAX_QUICK, eligibleQuick, resolveQuick, type QuickAccess } from "./quick-actions";

const office: QuickAccess = { canRaiseRequisition: false, canProgress: false, canUseCash: true, menus: ["/instructions", "/attendance", "/payroll"], canVerifyDelivery: false };
const owner: QuickAccess = { canRaiseRequisition: true, canProgress: true, canUseCash: true, menus: ["/dashboard", "/projects", "/requisitions", "/deliveries", "/instructions", "/attendance", "/payroll"], canVerifyDelivery: true };

const keys = (xs: { key: string }[]) => xs.map((x) => x.key);

describe("the + button", () => {
  it("offers only what the person may do", () => {
    expect(keys(eligibleQuick(office))).toEqual(["pettyCash", "clock", "instructions", "payslip", "notifications", "search"]);
    expect(keys(eligibleQuick(owner))).toEqual(["requisition", "progress", "pettyCash", "clock", "delivery", "instructions", "payslip", "notifications", "search"]);
  });

  it("starts with the main jobs they can do", () => {
    expect(keys(resolveQuick([], eligibleQuick(owner)))).toEqual(DEFAULT_QUICK);
    expect(keys(resolveQuick(undefined, eligibleQuick(office)))).toEqual(["pettyCash", "clock"]);
  });

  it("uses the person's own choice, in their order", () => {
    expect(keys(resolveQuick(["search", "payslip", "requisition"], eligibleQuick(owner)))).toEqual(["search", "payslip", "requisition"]);
  });

  it("drops anything they can no longer do, and falls back to the default if nothing is left", () => {
    expect(keys(resolveQuick(["requisition", "clock"], eligibleQuick(office)))).toEqual(["clock"]);
    expect(keys(resolveQuick(["requisition", "progress"], eligibleQuick(office)))).toEqual(["pettyCash", "clock"]);
  });

  it("ignores repeats, unknown names and anything beyond the limit", () => {
    const many = ["requisition", "requisition", "nope", "progress", "pettyCash", "clock", "delivery", "instructions", "payslip", "notifications", "search"];
    const got = keys(resolveQuick(many, eligibleQuick(owner)));
    expect(got).toHaveLength(MAX_QUICK);
    expect(new Set(got).size).toBe(got.length);
    expect(got).not.toContain("nope");
  });

  it("a person who cannot post progress (no project to post on) does not get it", () => {
    expect(keys(eligibleQuick({ ...owner, canProgress: false }))).not.toContain("progress");
  });
});
