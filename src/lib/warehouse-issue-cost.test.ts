import { describe, expect, it } from "vitest";
import { issueCostByProject, type IssueRow } from "./warehouse-issue-cost";

const mv = (o: Partial<IssueRow>): IssueRow => ({ type: "WAREHOUSE_TO_SITE", status: "APPLIED", qty: 1, unitPrice: 100, fromProjectId: null, toProjectId: "A", ...o });

describe("warehouse issue cost per project", () => {
  it("charges what was issued to the project, at the price logged (qty × price)", () => {
    const m = issueCostByProject([mv({ qty: 2, unitPrice: 455 }), mv({ qty: 3, unitPrice: 10 })]);
    expect(m.get("A")).toEqual({ cost: 940, unpriced: 0 });
  });

  it("counts an issue with no price as unpriced, not as ₱0 cost", () => {
    const m = issueCostByProject([mv({ qty: 2, unitPrice: null }), mv({ qty: 1, unitPrice: 50 })]);
    expect(m.get("A")).toEqual({ cost: 50, unpriced: 1 });
  });

  it("a return credits the project it came from, at the same price", () => {
    const m = issueCostByProject([mv({ qty: 10, unitPrice: 20 }), mv({ type: "SITE_TO_WAREHOUSE", qty: 4, unitPrice: 20, fromProjectId: "A", toProjectId: null })]);
    expect(m.get("A")?.cost).toBe(120);
  });

  it("a return of excess that was never issued from the warehouse credits nothing", () => {
    const m = issueCostByProject([mv({ qty: 10, unitPrice: 20 }), mv({ type: "SITE_TO_WAREHOUSE", qty: 4, unitPrice: 20, fromProjectId: "A", toProjectId: null, excess: true })]);
    expect(m.get("A")?.cost).toBe(200);
  });

  it("a transfer moves the value from one project to the other", () => {
    const m = issueCostByProject([mv({ qty: 10, unitPrice: 20 }), mv({ type: "SITE_TO_SITE", qty: 5, unitPrice: 20, fromProjectId: "A", toProjectId: "B" })]);
    expect(m.get("A")?.cost).toBe(100);
    expect(m.get("B")?.cost).toBe(100);
  });

  it("ignores requests still waiting, rejected ones, usage on site and supplier deliveries", () => {
    const m = issueCostByProject([
      mv({ status: "PENDING", type: "SITE_TO_WAREHOUSE", fromProjectId: "A", toProjectId: null }),
      mv({ status: "REJECTED" }),
      mv({ type: "CONSUMED_ON_SITE", fromProjectId: "A", toProjectId: null }),
      mv({ type: "SUPPLIER_TO_SITE" }),
      mv({ type: "SUPPLIER_TO_WAREHOUSE", toProjectId: null }),
    ]);
    expect(m.size).toBe(0);
  });

  it("never goes below zero, even if more was returned or moved on than the project was charged", () => {
    const m = issueCostByProject([mv({ type: "SITE_TO_SITE", qty: 5, unitPrice: 20, fromProjectId: "A", toProjectId: "B" })]);
    expect(m.get("A")?.cost).toBe(0);
    expect(m.get("B")?.cost).toBe(100);
  });

  it("keeps centavos exact (12.5 × ₱19.99)", () => {
    expect(issueCostByProject([mv({ qty: 12.5, unitPrice: 19.99 })]).get("A")?.cost).toBe(249.88);
  });
});
