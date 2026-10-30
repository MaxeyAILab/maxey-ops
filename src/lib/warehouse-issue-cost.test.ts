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

  it("never goes below zero, and a transfer moves nothing the project was not charged for", () => {
    const m = issueCostByProject([mv({ type: "SITE_TO_SITE", qty: 5, unitPrice: 20, fromProjectId: "A", toProjectId: "B" })]);
    expect(m.get("A")).toBeUndefined();
    expect(m.get("B")).toBeUndefined();
  });

  it("moves only the part that came from the warehouse when a transfer is bigger than what was issued (the rest was bought on a PO)", () => {
    const m = issueCostByProject([mv({ qty: 3, unitPrice: 20 }), mv({ type: "SITE_TO_SITE", qty: 10, unitPrice: 20, fromProjectId: "A", toProjectId: "B" })]);
    expect(m.get("A")?.cost).toBe(0);
    expect(m.get("B")?.cost).toBe(60);
  });

  it("matches a return to the same item: warehouse cost of one item is not credited for returning another bought on a PO", () => {
    const m = issueCostByProject([
      mv({ itemId: "cement", qty: 10, unitPrice: 20 }),
      mv({ type: "SITE_TO_WAREHOUSE", itemId: "sand", qty: 4, unitPrice: 50, fromProjectId: "A", toProjectId: null }),
    ]);
    expect(m.get("A")?.cost).toBe(200);
  });

  it("goes by the order things happened: a return logged before the issue gives back nothing", () => {
    const early = new Date("2026-10-01T00:00:00Z");
    const late = new Date("2026-10-02T00:00:00Z");
    const m = issueCostByProject([
      mv({ qty: 10, unitPrice: 20, createdAt: late }),
      mv({ type: "SITE_TO_WAREHOUSE", qty: 4, unitPrice: 20, fromProjectId: "A", toProjectId: null, createdAt: early }),
    ]);
    expect(m.get("A")?.cost).toBe(200);
  });

  it("a transferred part can be passed on again, and a second transfer cannot move it twice", () => {
    const m = issueCostByProject([
      mv({ qty: 5, unitPrice: 20 }),
      mv({ type: "SITE_TO_SITE", qty: 5, unitPrice: 20, fromProjectId: "A", toProjectId: "B" }),
      mv({ type: "SITE_TO_SITE", qty: 5, unitPrice: 20, fromProjectId: "A", toProjectId: "C" }),
      mv({ type: "SITE_TO_SITE", qty: 5, unitPrice: 20, fromProjectId: "B", toProjectId: "C" }),
    ]);
    expect(m.get("A")?.cost).toBe(0);
    expect(m.get("B")?.cost).toBe(0);
    expect(m.get("C")?.cost).toBe(100);
  });

  it("keeps centavos exact (12.5 × ₱19.99)", () => {
    expect(issueCostByProject([mv({ qty: 12.5, unitPrice: 19.99 })]).get("A")?.cost).toBe(249.88);
  });
});

describe("materials delivered on a project's PO and then moved on", () => {
  const delivered = (o: Partial<IssueRow> = {}) => mv({ type: "SUPPLIER_TO_SITE", deliveryId: "d1", qty: 10, unitPrice: 270, fromProjectId: null, toProjectId: "A", ...o });
  const transfer = (qty: number, from = "A", to = "B", o: Partial<IssueRow> = {}) => mv({ type: "SITE_TO_SITE", qty, unitPrice: 999, fromProjectId: from, toProjectId: to, ...o });

  it("a delivery adds no cost of its own — its cost is the PO's", () => {
    expect(issueCostByProject([delivered()]).size).toBe(0);
  });
  it("a transfer charges the receiving project for the items moved, at the PO price, and takes the same off the first project", () => {
    const m = issueCostByProject([delivered(), transfer(4)]);
    expect(m.get("B")?.cost).toBe(1080);
    expect(m.get("A")?.cost).toBe(-1080);
  });
  it("uses what the items cost where they were, not the catalogue price on the transfer", () => {
    const m = issueCostByProject([delivered({ unitPrice: 100 }), transfer(3, "A", "B", { unitPrice: 5000 })]);
    expect(m.get("B")?.cost).toBe(300);
  });
  it("the two projects together always add up to what was bought (nothing counted twice, nothing lost)", () => {
    const m = issueCostByProject([delivered(), transfer(6), transfer(2, "B", "C")]);
    const total = (m.get("A")?.cost ?? 0) + (m.get("B")?.cost ?? 0) + (m.get("C")?.cost ?? 0);
    expect(total).toBe(0);
    expect(m.get("B")?.cost).toBe(1620 - 540);
    expect(m.get("C")?.cost).toBe(540);
  });
  it("mixed stock moves in proportion at the average cost (5 from the warehouse at 20, 5 from a PO at 100)", () => {
    const m = issueCostByProject([mv({ qty: 5, unitPrice: 20 }), delivered({ qty: 5, unitPrice: 100 }), transfer(5)]);
    expect(m.get("B")?.cost).toBe(300); // 2.5 × 20 + 2.5 × 100
  });
  it("usage on site shrinks the holding without changing what an item costs", () => {
    const m = issueCostByProject([delivered(), mv({ type: "CONSUMED_ON_SITE", qty: 6, fromProjectId: "A", toProjectId: null }), transfer(4)]);
    expect(m.get("B")?.cost).toBe(1080);
  });
  it("materials logged by hand with no known cost move at no cost (nothing is invented)", () => {
    const m = issueCostByProject([mv({ type: "SUPPLIER_TO_SITE", qty: 10, unitPrice: 50, deliveryId: null, fromProjectId: null, toProjectId: "A" }), transfer(4)]);
    expect(m.get("B")).toBeUndefined();
  });
  it("sending delivered materials back to the warehouse credits nothing — the PO paid for them", () => {
    const m = issueCostByProject([delivered(), mv({ type: "SITE_TO_WAREHOUSE", qty: 4, fromProjectId: "A", toProjectId: null })]);
    expect(m.size).toBe(0);
  });
  it("what was transferred in is charged to the receiving project, so sending it back credits that project", () => {
    const m = issueCostByProject([delivered(), transfer(4), mv({ type: "SITE_TO_WAREHOUSE", qty: 4, fromProjectId: "B", toProjectId: null })]);
    expect(m.get("B")?.cost).toBe(0);
    expect(m.get("A")?.cost).toBe(-1080);
  });
  it("processes events in the order they were decided, not the order they are listed", () => {
    const m = issueCostByProject([
      transfer(4, "A", "B", { createdAt: new Date("2026-10-03T00:00:00Z") }),
      delivered({ createdAt: new Date("2026-10-01T00:00:00Z") }),
    ]);
    expect(m.get("B")?.cost).toBe(1080);
  });
});
