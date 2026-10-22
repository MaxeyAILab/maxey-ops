import { describe, expect, it } from "vitest";
import { WAREHOUSES, countByWarehouse, isWarehouse, warehouseFromSlug, warehouseLabel, warehouseSlug } from "./warehouses";

describe("warehouses", () => {
  it("are the four the company has, Main first", () => {
    expect(WAREHOUSES.map((w) => w.label)).toEqual(["Main Warehouse", "Alua Warehouse", "Ventus Warehouse", "Barangay Warehouse"]);
  });

  it("recognises only real warehouses", () => {
    expect(isWarehouse("ALUA")).toBe(true);
    expect(isWarehouse("alua")).toBe(false);
    expect(isWarehouse("OFFICE")).toBe(false);
    expect(isWarehouse(null)).toBe(false);
  });

  it("turns a page-address slug into a warehouse, falling back to Main", () => {
    expect(warehouseFromSlug("ventus")).toBe("VENTUS");
    expect(warehouseFromSlug("barangay")).toBe("BARANGAY");
    expect(warehouseFromSlug("nonsense")).toBe("MAIN");
    expect(warehouseFromSlug(undefined)).toBe("MAIN");
    expect(warehouseSlug("ALUA")).toBe("alua");
  });

  it("names a warehouse for people, Main when unknown", () => {
    expect(warehouseLabel("ALUA")).toBe("Alua Warehouse");
    expect(warehouseLabel("???")).toBe("Main Warehouse");
    expect(warehouseLabel(null)).toBe("Main Warehouse");
  });

  it("counts things per warehouse, listing all four even when empty", () => {
    expect(countByWarehouse([{ warehouse: "MAIN" }, { warehouse: "MAIN" }, { warehouse: "ALUA" }])).toEqual({ MAIN: 2, ALUA: 1, VENTUS: 0, BARANGAY: 0 });
    expect(countByWarehouse([])).toEqual({ MAIN: 0, ALUA: 0, VENTUS: 0, BARANGAY: 0 });
  });
});
