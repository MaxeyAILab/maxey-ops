import { describe, expect, it } from "vitest";
import { REQUEST_LABEL, decisionText } from "./inventory-labels";
import { MATERIAL_REQUEST_TYPES, TOOL_REQUEST_TYPES } from "./inventory-requests";

const fmt = (d: Date) => d.toISOString().slice(0, 10);
const day = new Date("2026-10-21T08:00:00Z");

describe("which movements are requests", () => {
  it("only returns and transfers wait for approval", () => {
    expect([...MATERIAL_REQUEST_TYPES].sort()).toEqual(["SITE_TO_SITE", "SITE_TO_WAREHOUSE"]);
    expect([...TOOL_REQUEST_TYPES].sort()).toEqual(["RETURN_TO_WAREHOUSE", "TRANSFER_SITE_TO_SITE"]);
  });

  it("names them the way people say them", () => {
    expect(REQUEST_LABEL.SITE_TO_WAREHOUSE).toBe("Return to warehouse");
    expect(REQUEST_LABEL.RETURN_TO_WAREHOUSE).toBe("Return to warehouse");
    expect(REQUEST_LABEL.SITE_TO_SITE).toBe("Transfer to project");
    expect(REQUEST_LABEL.TRANSFER_SITE_TO_SITE).toBe("Transfer to project");
  });
});

describe("what the log says about the approval", () => {
  it("says it is waiting", () => {
    expect(decisionText({ status: "PENDING" }, fmt)).toBe("Waiting for approval");
  });

  it("shows who approved and when", () => {
    expect(decisionText({ status: "APPLIED", decidedByName: "Vanie Rose A. Labe", decidedAt: day }, fmt)).toBe("Approved by Vanie Rose A. Labe · 2026-10-21");
  });

  it("shows who rejected, when, and why", () => {
    expect(decisionText({ status: "REJECTED", decidedByName: "Jonnel Magno", decidedAt: day, rejectedReason: "Wrong project" }, fmt)).toBe("Rejected by Jonnel Magno · 2026-10-21 — Wrong project");
  });

  it("says nothing for movements that never needed approval (and old ones)", () => {
    expect(decisionText({ status: "APPLIED" }, fmt)).toBeNull();
  });
});
