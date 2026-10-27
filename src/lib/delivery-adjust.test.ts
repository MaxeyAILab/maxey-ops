import { describe, expect, it } from "vitest";
import { adjustRequisitionItems, discrepancyLines, isDeliveryComplete, planAdjustment, poTotal } from "./delivery-adjust";

const po = [
  { name: "Cement", qty: 5, unit: "bags", unitCost: 250 },
  { name: "Sand", qty: 10, unit: "cu.m", unitCost: 1200.5 },
  { name: "Nails", qty: 2, unit: "kg", unitCost: 90 },
];

describe("discrepancyLines", () => {
  it("lists only what did not arrive as ordered", () => {
    const rows = [
      { item: "Cement", orderedQty: 5, receivedQty: 2, ok: true, remarks: "truck was short" },
      { item: "Sand", orderedQty: 10, receivedQty: 10, ok: true },
      { item: "Nails", orderedQty: 2, receivedQty: 2, ok: false, remarks: "rusty" },
    ];
    expect(discrepancyLines(rows)).toEqual(["Cement: ordered 5, received 2 — truck was short", "Nails: ordered 2, received 2 — rusty"]);
  });

  it("is empty when everything tallies (more than ordered is not a shortage)", () => {
    expect(discrepancyLines([{ item: "Cement", orderedQty: 5, receivedQty: 6, ok: true }])).toEqual([]);
  });
});

describe("isDeliveryComplete", () => {
  it("is complete with no discrepancies, or when the Owner accepted it", () => {
    expect(isDeliveryComplete({ discrepancies: null })).toBe(true);
    expect(isDeliveryComplete({ discrepancies: "Cement: ordered 5, received 2", acceptedAt: null })).toBe(false);
    expect(isDeliveryComplete({ discrepancies: "Cement: ordered 5, received 2", acceptedAt: new Date() })).toBe(true);
  });
});

describe("planAdjustment", () => {
  it("sets each short item to the delivered quantity and recomputes the PO total", () => {
    const plan = planAdjustment(po, [
      { item: "Cement", orderedQty: 5, receivedQty: 2, ok: true },
      { item: "Sand", orderedQty: 10, receivedQty: 10, ok: true },
    ]);
    expect(plan.lines).toEqual([{ item: "Cement", unit: "bags", unitCost: 250, from: 5, to: 2, costChange: -750 }]);
    expect(plan.totalBefore).toBe(poTotal(po));
    expect(plan.totalAfter).toBe(2 * 250 + 10 * 1200.5 + 2 * 90);
    expect(plan.totalBefore - plan.totalAfter).toBe(750);
    expect(plan.poItems.map((i) => i.qty)).toEqual([2, 10, 2]);
    expect(plan.unchanged).toBe(false);
  });

  it("leaves items the delivery did not list alone, and ignores letter case", () => {
    const plan = planAdjustment(po, [{ item: "  cement ", orderedQty: 5, receivedQty: 3, ok: true }]);
    expect(plan.poItems.map((i) => i.qty)).toEqual([3, 10, 2]);
  });

  it("can raise a quantity (more delivered than ordered) and shows the added cost", () => {
    const plan = planAdjustment(po, [{ item: "Nails", orderedQty: 2, receivedQty: 3, ok: true }]);
    expect(plan.lines[0]).toMatchObject({ from: 2, to: 3, costChange: 90 });
    expect(plan.totalAfter - plan.totalBefore).toBe(90);
  });

  it("an item that never arrived goes to 0 and costs nothing", () => {
    const plan = planAdjustment(po, [{ item: "Sand", orderedQty: 10, receivedQty: 0, ok: false }]);
    expect(plan.lines[0].to).toBe(0);
    expect(plan.totalAfter).toBe(5 * 250 + 2 * 90);
  });

  it("reports nothing to change when the PO already matches", () => {
    const plan = planAdjustment(po, [{ item: "Cement", orderedQty: 5, receivedQty: 5, ok: true }]);
    expect(plan.unchanged).toBe(true);
    expect(plan.totalAfter).toBe(plan.totalBefore);
  });

  it("keeps cents exact", () => {
    const plan = planAdjustment([{ name: "Wire", qty: 3, unit: "m", unitCost: 19.99 }], [{ item: "Wire", orderedQty: 3, receivedQty: 1.5, ok: true }]);
    expect(plan.totalAfter).toBe(29.99);
    expect(plan.lines[0].costChange).toBe(-29.98); // 29.99 − 59.97, so the lines add up to the total
  });
});

describe("adjustRequisitionItems", () => {
  const reqItems = [
    { id: "r1", name: "Cement", qty: 5, estUnitCost: 240 },
    { id: "r2", name: "Sand", qty: 10, estUnitCost: 1200 },
    { id: "r3", name: "Nails", qty: 2, estUnitCost: null },
  ];

  it("changes the matching requisition items and recomputes the estimate", () => {
    const r = adjustRequisitionItems(reqItems, [{ item: "cement", to: 2 }]);
    expect(r.items).toEqual([{ id: "r1", from: 5, to: 2 }]);
    expect(r.estimatedAfter).toBe(2 * 240 + 10 * 1200);
    expect(r.unmatched).toEqual([]);
  });

  it("says which PO items have no matching requisition item", () => {
    const r = adjustRequisitionItems(reqItems, [{ item: "Gravel", to: 1 }]);
    expect(r.items).toEqual([]);
    expect(r.unmatched).toEqual(["Gravel"]);
  });
});

describe("planAdjustment — items issued from the warehouse", () => {
  it("never changes them: the stock was already issued, so a short count does not shrink the PO line", () => {
    const po = [
      { name: "Primer", qty: 4, unit: "pail", unitCost: 0, fromWarehouse: true },
      { name: "Paint", qty: 2, unit: "pcs", unitCost: 100 },
    ];
    const plan = planAdjustment(po, [
      { item: "Primer", orderedQty: 4, receivedQty: 3, ok: true },
      { item: "Paint", orderedQty: 2, receivedQty: 1, ok: true },
    ]);
    expect(plan.lines.map((l) => l.item)).toEqual(["Paint"]);
    expect(plan.poItems[0].qty).toBe(4);
    expect(plan.totalAfter).toBe(100);
  });
});
