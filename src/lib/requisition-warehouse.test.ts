import { describe, expect, it } from "vitest";
import { matchWarehouseStock, planWarehouseUse, purchaseEstimate, warehouseShortfalls, type StockOption } from "./requisition-warehouse";

const s = (id: string, name: string, qty: number, warehouse = "MAIN"): StockOption => ({ id, name, unit: "pcs", warehouse, currentQty: qty });
const stock = [s("1", 'Tubular 1"x2"', 12), s("2", 'Tubular 1-1/2" x2"', 0), s("3", "Acrytex primer", 4), s("4", 'Tubular 1"x2"', 30, "ALUA")];

describe("matching warehouse stock to what was typed", () => {
  it("needs every typed word to be in the item's name, ignoring case", () => {
    expect(matchWarehouseStock("tubular", stock).map((i) => i.id)).toEqual(["4", "1", "2"]);
    expect(matchWarehouseStock("PRIMER acrytex", stock).map((i) => i.id)).toEqual(["3"]);
    expect(matchWarehouseStock("cement", stock)).toEqual([]);
  });
  it("lists items with stock first (most first) and out-of-stock ones last", () => {
    const ids = matchWarehouseStock("tubular", stock).map((i) => i.id);
    expect(ids[ids.length - 1]).toBe("2");
  });
  it("shows nothing until there are at least two characters", () => {
    expect(matchWarehouseStock("t", stock)).toEqual([]);
    expect(matchWarehouseStock("  ", stock)).toEqual([]);
  });
});

describe("how much the warehouse can cover", () => {
  it("covers it all when there is enough", () => expect(planWarehouseUse(5, 12)).toEqual({ fromWarehouse: 5, toBuy: 0 }));
  it("covers part and leaves the rest to buy", () => expect(planWarehouseUse(5, 3)).toEqual({ fromWarehouse: 3, toBuy: 2 }));
  it("covers nothing when the warehouse is empty or negative", () => {
    expect(planWarehouseUse(5, 0)).toEqual({ fromWarehouse: 0, toBuy: 5 });
    expect(planWarehouseUse(5, -2)).toEqual({ fromWarehouse: 0, toBuy: 5 });
  });
});

describe("requisition estimate", () => {
  it("leaves warehouse lines out of the estimate (they are charged when issued)", () => {
    const lines = [
      { name: "a", qty: 2, unit: "pcs", estUnitCost: 100, warehouseItemId: null },
      { name: "b", qty: 5, unit: "pcs", estUnitCost: 455, warehouseItemId: "1" },
      { name: "c", qty: 1, unit: "pcs", estUnitCost: null, warehouseItemId: null },
    ];
    expect(purchaseEstimate(lines)).toBe(200);
  });
});

describe("shortfalls at approval", () => {
  const map = new Map(stock.map((i) => [i.id, i]));
  it("is empty when the warehouse holds enough", () => {
    expect(warehouseShortfalls([{ warehouseItemId: "1", qty: 12 }, { warehouseItemId: null, qty: 500 }], map)).toEqual([]);
  });
  it("adds up two lines for the same item", () => {
    const r = warehouseShortfalls([{ warehouseItemId: "3", qty: 3 }, { warehouseItemId: "3", qty: 2 }], map);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ itemId: "3", wanted: 5, available: 4 });
  });
  it("flags an item that no longer exists", () => {
    expect(warehouseShortfalls([{ warehouseItemId: "gone", qty: 1 }], map)[0].available).toBe(0);
  });
});
