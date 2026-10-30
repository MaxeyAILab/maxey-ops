import { describe, expect, it } from "vitest";
import { desiredStock, findExistingItem, guessCategory, itemKey, normalizeName, normalizeUnit, planDeliveryStock, type CatalogueEntry } from "./delivery-stock-plan";

const po = [
  { name: 'Tubular 1"x2"', unit: "pcs", unitCost: 455 },
  { name: "Cement", unit: "bag", unitCost: 270 },
  { name: "Plywood 1/2", unit: "pc", unitCost: 0, fromWarehouse: true },
];

describe("what a delivery should have put on site", () => {
  it("is every line's received quantity, with its unit and PO price", () => {
    const d = desiredStock(
      [
        { item: 'Tubular 1"x2"', receivedQty: 10 },
        { item: "Cement", receivedQty: 40 },
      ],
      po,
      true
    );
    expect(d.get('Tubular 1"x2"')).toEqual({ qty: 10, unit: "pcs", unitCost: 455 });
    expect(d.get("Cement")).toEqual({ qty: 40, unit: "bag", unitCost: 270 });
  });
  it("counts what was RECEIVED, not what was ordered, and skips lines that received nothing", () => {
    const d = desiredStock([{ item: "Cement", receivedQty: 12.5 }, { item: 'Tubular 1"x2"', receivedQty: 0 }], po, true);
    expect([...d.keys()]).toEqual(["Cement"]);
    expect(d.get("Cement")?.qty).toBe(12.5);
  });
  it("leaves out warehouse-sourced lines — they went on site when the requisition was approved", () => {
    expect(desiredStock([{ item: "Plywood 1/2", receivedQty: 4 }], po, true).size).toBe(0);
  });
  it("adds up two lines with the same name", () => {
    expect(desiredStock([{ item: "Cement", receivedQty: 10 }, { item: "Cement", receivedQty: 5 }], po, true).get("Cement")?.qty).toBe(15);
  });
  it("finds the PO line whatever the capital letters or spaces around the name", () => {
    expect(desiredStock([{ item: "  cement ", receivedQty: 3 }], po, true).get("  cement ")?.unit).toBe("bag");
  });
  it("is nothing at all when the delivery does not count (not verified, old, or no project)", () => {
    expect(desiredStock([{ item: "Cement", receivedQty: 10 }], po, false).size).toBe(0);
  });
});

describe("the movements to add, change or remove", () => {
  const want = new Map([
    ["Cement", { qty: 40, unit: "bag", unitCost: 270 }],
    ["Sand", { qty: 2, unit: "cu.m", unitCost: 1500 }],
  ]);
  it("adds every line the first time", () => {
    const a = planDeliveryStock(want, []);
    expect(a.map((x) => x.kind)).toEqual(["add", "add"]);
  });
  it("does nothing the second time — a delivery can never add its materials twice", () => {
    const again = planDeliveryStock(want, [
      { id: "m1", deliveryLine: "Cement", qty: 40 },
      { id: "m2", deliveryLine: "Sand", qty: 2 },
    ]);
    expect(again).toEqual([]);
  });
  it("changes the existing movement when the quantity is corrected, instead of adding another", () => {
    const a = planDeliveryStock(want, [{ id: "m1", deliveryLine: "Cement", qty: 30 }, { id: "m2", deliveryLine: "Sand", qty: 2 }]);
    expect(a).toEqual([{ kind: "change", movementId: "m1", line: "Cement", from: 30, to: 40 }]);
  });
  it("removes a line that no longer has anything received, and everything when the delivery no longer counts", () => {
    expect(planDeliveryStock(new Map([["Cement", { qty: 40, unit: "bag", unitCost: 270 }]]), [{ id: "m1", deliveryLine: "Cement", qty: 40 }, { id: "m2", deliveryLine: "Sand", qty: 2 }])).toEqual([{ kind: "remove", movementId: "m2", line: "Sand", qty: 2 }]);
    expect(planDeliveryStock(new Map(), [{ id: "m1", deliveryLine: "Cement", qty: 40 }]).map((x) => x.kind)).toEqual(["remove"]);
  });
  it("ignores a stray movement with no delivery line", () => {
    expect(planDeliveryStock(new Map(), [{ id: "x", deliveryLine: null, qty: 5 }])).toEqual([]);
  });
});

describe("recognising the same item", () => {
  it("ignores capitals, spaces and quote marks in the name", () => {
    expect(normalizeName('Tubular 1" x 2"')).toBe(normalizeName("tubular 1x2"));
    expect(normalizeName("GI  Wire #16")).toBe(normalizeName("gi wire #16"));
  });
  it("keeps different sizes apart", () => {
    expect(normalizeName("Plywood 1/2")).not.toBe(normalizeName("Plywood 12"));
    expect(normalizeName("PVC 1-1/2")).not.toBe(normalizeName("PVC 1/12"));
    expect(normalizeName("Rebar 10mm")).not.toBe(normalizeName("Rebar 12mm"));
  });
  it("treats pcs / pc / piece(s) as one unit, bag / bags as one, and keeps different units apart", () => {
    expect(normalizeUnit("PCS")).toBe(normalizeUnit("piece"));
    expect(normalizeUnit("bags")).toBe(normalizeUnit("Bag"));
    expect(normalizeUnit("bag")).not.toBe(normalizeUnit("pcs"));
    expect(normalizeUnit("m")).not.toBe(normalizeUnit("kg"));
  });
  it("is the same item only when the name and the unit both match", () => {
    expect(itemKey("Cement", "bag")).toBe(itemKey("cement", "Bags"));
    expect(itemKey("Cement", "bag")).not.toBe(itemKey("Cement", "kg"));
  });

  const e = (id: string, name: string, unit: string, warehouse = "MAIN"): CatalogueEntry => ({ id, name, unit, warehouse });
  it("prefers an item already on the project's list, then the catalogue, else nothing (a new item is added)", () => {
    const onSite = [e("site", "Cement", "bags", "ALUA")];
    const catalogue = [e("main", "Cement", "bag"), e("site", "Cement", "bags", "ALUA")];
    expect(findExistingItem("cement", "bag", onSite, catalogue)?.id).toBe("site");
    expect(findExistingItem("cement", "bag", [], catalogue)?.id).toBe("main");
    expect(findExistingItem("Deformed bar 12mm", "pcs", onSite, catalogue)).toBeNull();
  });
});

describe("the group of a new item", () => {
  it("guesses from the name and falls back to Others", () => {
    expect(guessCategory("THHN Wire 3.5mm")).toBe("ELECTRICAL");
    expect(guessCategory("PVC elbow 2 inch")).toBe("PLUMBING");
    expect(guessCategory("Portland Cement")).toBe("CIVIL_ARCHITECTURAL");
    expect(guessCategory("Safety gloves")).toBe("OTHERS");
  });
});

describe("lines taken from the warehouse", () => {
  const poW = [
    { name: "ZZ Rebar", unit: "pcs", unitCost: 0, fromWarehouse: true, issueOnDelivery: true, warehouseItemId: "w1", requisitionItemId: "r1" },
    { name: "ZZ Old", unit: "pcs", unitCost: 0, fromWarehouse: true },
    { name: "ZZ Bought", unit: "pcs", unitCost: 5 },
  ];
  it("a line made to be issued on delivery is issued to the project for what was received", () => {
    const d = desiredStock([{ item: "ZZ Rebar", receivedQty: 7 }], poW, true);
    expect(d.get("ZZ Rebar")).toEqual({ qty: 7, unit: "pcs", unitCost: 0, warehouse: { itemId: "w1", requisitionItemId: "r1" } });
  });
  it("an older warehouse line (issued when the requisition was approved) is left alone", () => {
    expect(desiredStock([{ item: "ZZ Old", receivedQty: 3 }], poW, true).size).toBe(0);
  });
  it("a bought line next to it still comes from the supplier", () => {
    const d = desiredStock([{ item: "ZZ Bought", receivedQty: 2 }, { item: "ZZ Rebar", receivedQty: 1 }], poW, true);
    expect(d.get("ZZ Bought")?.warehouse).toBeUndefined();
    expect(d.get("ZZ Rebar")?.warehouse?.itemId).toBe("w1");
  });
  it("the plan carries the warehouse source into the add action and does nothing the second time", () => {
    const d = desiredStock([{ item: "ZZ Rebar", receivedQty: 7 }], poW, true);
    const first = planDeliveryStock(d, []);
    expect(first[0]).toMatchObject({ kind: "add", line: "ZZ Rebar", qty: 7, warehouse: { itemId: "w1" } });
    expect(planDeliveryStock(d, [{ id: "m", deliveryLine: "ZZ Rebar", qty: 7 }])).toEqual([]);
  });
});
