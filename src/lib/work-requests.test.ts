import { describe, expect, it } from "vitest";
import { costImpactWording } from "./change-orders";
import {
  canRecordClientInstruction,
  canReviewWorkRequest,
  canSubmitWorkRequest,
  canWithdrawWorkRequest,
  clientStatusLabel,
  formatWorkRequestNumber,
  isOpenWorkRequest,
  requestStage,
  validateConversion,
  validateInstructedOn,
} from "./work-requests";

describe("work request rules", () => {
  it("formats project-scoped numbers", () => {
    expect(formatWorkRequestNumber(4)).toBe("CR-004");
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
    expect(clientStatusLabel("CONVERTED")).toContain("Quotation");
    expect(clientStatusLabel("DECLINED")).not.toMatch(/declin/i);
  });

  it("requires an explicit cost and time before converting", () => {
    expect(validateConversion({ costImpact: null, timeImpactDays: 3 })).toMatch(/cost/i);
    expect(validateConversion({ costImpact: 5000, timeImpactDays: undefined })).toMatch(/time/i);
    expect(validateConversion({ costImpact: NaN, timeImpactDays: 3 })).toMatch(/cost/i);
    expect(validateConversion({ costImpact: -1, timeImpactDays: 3 })).toMatch(/negative|credit/i);
    expect(validateConversion({ costImpact: 100, timeImpactDays: 2.5 })).toMatch(/whole/i);
    expect(validateConversion({ costImpact: 100, timeImpactDays: -2 })).toMatch(/whole/i);
  });

  it("accepts a typed zero cost but never a blank", () => {
    expect(validateConversion({ costImpact: 0, timeImpactDays: 0 })).toBeNull();
    expect(validateConversion({ costImpact: 125000.5, timeImpactDays: 14 })).toBeNull();
  });

  it("lets the sign of the price follow the kind of request", () => {
    // new work can't be a credit
    expect(validateConversion({ costImpact: -500, timeImpactDays: 0 }, "ADDITION")).not.toBeNull();
    // a reduction is a credit: negative or zero, never added cost
    expect(validateConversion({ costImpact: -500, timeImpactDays: 0 }, "REDUCTION")).toBeNull();
    expect(validateConversion({ costImpact: 0, timeImpactDays: 0 }, "REDUCTION")).toBeNull();
    expect(validateConversion({ costImpact: 500, timeImpactDays: 0 }, "REDUCTION")).toMatch(/credit/i);
    // a change to existing work can cost more or less
    expect(validateConversion({ costImpact: -500, timeImpactDays: 2 }, "CHANGE")).toBeNull();
    expect(validateConversion({ costImpact: 500, timeImpactDays: 2 }, "CHANGE")).toBeNull();
    // a blank is still never turned into zero, whatever the kind
    expect(validateConversion({ costImpact: null, timeImpactDays: 1 }, "REDUCTION")).toMatch(/cost/i);
  });

  it("lets the Owner, PM and Foreman record an instruction the client gave outside the portal", () => {
    for (const r of ["OWNER", "PM", "FOREMAN"]) expect(canRecordClientInstruction(r)).toBe(true);
    for (const r of ["CLIENT", "ACCOUNTING", "PURCHASING", "OFFICE", "DRIVER"]) expect(canRecordClientInstruction(r)).toBe(false);
  });

  it("only accepts an instruction date that is today or in the recent past", () => {
    const now = new Date("2026-10-13T08:00:00+08:00");
    expect(validateInstructedOn(new Date("2026-10-13T00:00:00Z"), now)).toBeNull();
    expect(validateInstructedOn(new Date("2026-10-01T00:00:00Z"), now)).toBeNull();
    expect(validateInstructedOn(new Date("2026-10-14T00:00:00Z"), now)).toMatch(/future/);
    expect(validateInstructedOn(new Date("2025-01-01T00:00:00Z"), now)).toMatch(/year/);
    expect(validateInstructedOn(null, now)).toBeNull();
  });

  it("does not let a client withdraw an instruction the team recorded for them", () => {
    const client = { id: "u", role: "CLIENT", clientId: "c1" };
    expect(canWithdrawWorkRequest({ status: "REQUESTED", source: "PORTAL" }, client, "c1")).toBe(true);
    for (const source of ["PHONE", "MESSAGE", "EMAIL", "MEETING", "SITE"] as const) {
      expect(canWithdrawWorkRequest({ status: "REQUESTED", source }, client, "c1")).toBe(false);
    }
  });

  describe("requestStage — one story for the request and its change order", () => {
    it("walks a request from submitted to the client's decision", () => {
      expect(requestStage({ status: "REQUESTED" }, null, "client")).toMatchObject({ step: 1, label: "Submitted" });
      expect(requestStage({ status: "UNDER_REVIEW" }, null, "client")).toMatchObject({ step: 2, label: "Being priced" });
      expect(requestStage({ status: "CONVERTED" }, { status: "PENDING_CLIENT" }, "client")).toMatchObject({ step: 3, tone: "action" });
      expect(requestStage({ status: "CONVERTED" }, { status: "APPROVED" }, "client")).toMatchObject({ step: 4, tone: "good", label: "Approved" });
      expect(requestStage({ status: "CONVERTED" }, { status: "REJECTED" }, "client")).toMatchObject({ step: 4, tone: "closed" });
    });

    it("words the same stage differently for the client and for staff", () => {
      expect(requestStage({ status: "REQUESTED" }, null, "staff").label).toMatch(/needs review/);
      expect(requestStage({ status: "CONVERTED" }, { status: "PENDING_CLIENT" }, "client").label).toMatch(/your approval/);
      expect(requestStage({ status: "CONVERTED" }, { status: "PENDING_CLIENT" }, "staff").label).toMatch(/awaiting the client/);
      expect(requestStage({ status: "DECLINED" }, null, "client").label).toBe("Not going ahead");
      expect(requestStage({ status: "DECLINED" }, null, "staff").label).toBe("Declined");
    });

    it("never shows the client an internal withdrawn or potential change order", () => {
      for (const status of ["WITHDRAWN", "POTENTIAL"]) {
        const client = requestStage({ status: "CONVERTED" }, { status }, "client");
        expect(client.label).toBe("Being reviewed");
        expect(client.label).not.toMatch(/withdraw|potential/i);
      }
      expect(requestStage({ status: "CONVERTED" }, { status: "WITHDRAWN" }, "staff").label).toBe("Quotation withdrawn");
    });
  });

  it("reads a credit as a credit to the client, not as negative additional cost", () => {
    expect(costImpactWording(-5000)).toEqual({ label: "Credit to you", amount: 5000 });
    expect(costImpactWording(12000)).toEqual({ label: "Additional cost", amount: 12000 });
    expect(costImpactWording(0)).toEqual({ label: "No change in price", amount: null });
  });
});
