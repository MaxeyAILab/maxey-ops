import { describe, expect, it } from "vitest";
import { canVerifyDelivery } from "./access";

describe("who can verify a delivery", () => {
  it("includes a driver whose account is Office staff in the Driver department", () => {
    expect(canVerifyDelivery("OFFICE", "DRIVER")).toBe(true);
  });

  it("still includes the roles and the engineers it always did", () => {
    for (const role of ["FOREMAN", "PM", "OWNER", "DRIVER"] as const) expect(canVerifyDelivery(role, null), role).toBe(true);
    expect(canVerifyDelivery("OFFICE", "ENGINEER")).toBe(true);
  });

  it("does not include other office staff, purchasing, accounting or clients", () => {
    expect(canVerifyDelivery("OFFICE", "OFFICE")).toBe(false);
    expect(canVerifyDelivery("OFFICE", "SITE")).toBe(false);
    expect(canVerifyDelivery("OFFICE", null)).toBe(false);
    expect(canVerifyDelivery("PURCHASING", "OFFICE")).toBe(false);
    expect(canVerifyDelivery("ACCOUNTING", null)).toBe(false);
    expect(canVerifyDelivery("CLIENT", null)).toBe(false);
  });
});
