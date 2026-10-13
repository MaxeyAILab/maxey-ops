import { describe, expect, it } from "vitest";
import {
  canReviewWorkRequest,
  canSubmitWorkRequest,
  canWithdrawWorkRequest,
  clientStatusLabel,
  formatWorkRequestNumber,
  isOpenWorkRequest,
  validateConversion,
} from "./work-requests";

describe("work request rules", () => {
  it("formats project-scoped numbers", () => {
    expect(formatWorkRequestNumber(4)).toBe("AW-004");
  });

  it("treats only requested and under-review as open", () => {
    expect(isOpenWorkRequest("REQUESTED")).toBe(true);
    expect(isOpenWorkRequest("UNDER_REVIEW")).toBe(true);
    for (const s of ["CONVERTED", "DECLINED", "WITHDRAWN"] as const) expect(isOpenWorkRequest(s)).toBe(false);
  });

  it("lets only Owner and PM assess requests", () => {
    expect(canReviewWorkRequest("OWNER")).toBe(true);
    expect(canReviewWorkRequest("PM")).toBe(true);
    for (const r of ["FOREMAN", "ACCOUNTING", "PURCHASING", "OFFICE", "DRIVER", "CLIENT"]) expect(canReviewWorkRequest(r)).toBe(false);
  });

  it("lets only the project's own client submit", () => {
    expect(canSubmitWorkRequest({ id: "u", role: "CLIENT", clientId: "c1" }, "c1")).toBe(true);
    expect(canSubmitWorkRequest({ id: "u", role: "CLIENT", clientId: "c2" }, "c1")).toBe(false);
    expect(canSubmitWorkRequest({ id: "u", role: "CLIENT", clientId: null }, "c1")).toBe(false);
    expect(canSubmitWorkRequest({ id: "u", role: "OWNER", clientId: null }, "c1")).toBe(false);
    expect(canSubmitWorkRequest({ id: "u", role: "PM" }, "c1")).toBe(false);
  });

  it("lets a client withdraw only while the team hasn't decided", () => {
    const client = { id: "u", role: "CLIENT", clientId: "c1" };
    expect(canWithdrawWorkRequest({ status: "REQUESTED" }, client, "c1")).toBe(true);
    expect(canWithdrawWorkRequest({ status: "UNDER_REVIEW" }, client, "c1")).toBe(true);
    expect(canWithdrawWorkRequest({ status: "CONVERTED" }, client, "c1")).toBe(false);
    expect(canWithdrawWorkRequest({ status: "DECLINED" }, client, "c1")).toBe(false);
    expect(canWithdrawWorkRequest({ status: "REQUESTED" }, { ...client, clientId: "c2" }, "c1")).toBe(false);
  });

  it("describes status to clients in plain language", () => {
    expect(clientStatusLabel("REQUESTED")).toBe("Submitted");
    expect(clientStatusLabel("CONVERTED")).toContain("change order");
    expect(clientStatusLabel("DECLINED")).not.toMatch(/declin/i);
  });

  it("requires an explicit cost and time before converting", () => {
    expect(validateConversion({ costImpact: null, timeImpactDays: 3 })).toMatch(/cost/i);
    expect(validateConversion({ costImpact: 5000, timeImpactDays: undefined })).toMatch(/time/i);
    expect(validateConversion({ costImpact: NaN, timeImpactDays: 3 })).toMatch(/cost/i);
    expect(validateConversion({ costImpact: -1, timeImpactDays: 3 })).toMatch(/negative/i);
    expect(validateConversion({ costImpact: 100, timeImpactDays: 2.5 })).toMatch(/whole/i);
    expect(validateConversion({ costImpact: 100, timeImpactDays: -2 })).toMatch(/whole/i);
  });

  it("accepts a typed zero cost but never a blank", () => {
    expect(validateConversion({ costImpact: 0, timeImpactDays: 0 })).toBeNull();
    expect(validateConversion({ costImpact: 125000.5, timeImpactDays: 14 })).toBeNull();
  });
});
