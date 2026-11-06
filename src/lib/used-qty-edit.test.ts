import { describe, expect, it } from "vitest";
import { usedQtyStockChange } from "./used-qty-edit";

describe("correcting a used-on-site quantity", () => {
  it("leaves the site stock alone by default (22 typed, 11 really used)", () => {
    expect(usedQtyStockChange(22, 11, false)).toBe(0);
  });
  it("gives the difference back when the Owner asks for it", () => {
    expect(usedQtyStockChange(22, 11, true)).toBe(11);
  });
  it("takes more from the site when the usage was larger than logged", () => {
    expect(usedQtyStockChange(10, 12.5, true)).toBe(-2.5);
  });
  it("no change in quantity changes nothing", () => {
    expect(usedQtyStockChange(5, 5, true)).toBe(0);
  });
});
