import { describe, expect, it } from "vitest";
import { availablePieces, shortagePhrase, wholeQty } from "./tool-lots";
import { isCountedCategory, normalizeToolCategory, summarizeToolCategories, toolCategoryKey, toolCategoryFromSlug } from "./tool-category";
import { countByWarehouse } from "./warehouses";
import { toolFilterCounts } from "./tool-filter";

describe("counted tools", () => {
  it("the new group is recognised however it is typed", () => {
    expect(toolCategoryKey("Scaffolding & Shoring")).toBe("SCAFFOLD");
    expect(toolCategoryKey("scaffolding")).toBe("SCAFFOLD");
    expect(toolCategoryKey("Shoring jacks")).toBe("SCAFFOLD");
    expect(isCountedCategory("Scaffolding & Shoring")).toBe(true);
    expect(isCountedCategory("Power Tools")).toBe(false);
    expect(normalizeToolCategory("shoring")).toBe("Scaffolding & Shoring");
    expect(toolCategoryFromSlug("scaffolding-shoring")).toBe("SCAFFOLD");
  });
  it("only whole pieces from 1 up are accepted", () => {
    expect(wholeQty("25")).toBe(25);
    expect(wholeQty(3)).toBe(3);
    for (const bad of [0, -2, 1.5, "", "abc", null, undefined, 2_000_000]) expect(wholeQty(bad)).toBeNull();
  });
  it("what is free to move is what the pool holds minus requests already waiting", () => {
    expect(availablePieces(100, 30)).toBe(70);
    expect(availablePieces(10, 30)).toBe(0);
    expect(shortagePhrase("Base jack", 70, 100, 30)).toBeNull();
    expect(shortagePhrase("Base jack", 80, 100, 30)).toMatch(/Only 70 Base jack are available here \(30 more are already waiting/);
    expect(shortagePhrase("Base jack", 5, 3, 0)).toMatch(/Only 3 Base jack are available here — 5 asked for/);
  });
  it("tiles, tabs and filters count pieces, and an empty pool counts nothing", () => {
    const base = { workingStatus: "WORKING", warehouse: "MAIN", name: "Base jack", assetTag: null };
    const rows = [
      { ...base, category: "Scaffolding & Shoring", status: "IN_WAREHOUSE", quantity: 80, location: "Main Warehouse" },
      { ...base, category: "Scaffolding & Shoring", status: "ON_SITE", quantity: 20, location: "Site A" },
      { ...base, category: "Scaffolding & Shoring", status: "LOST", quantity: 2, location: "Site A" },
      { ...base, category: "Scaffolding & Shoring", status: "ON_SITE", quantity: 0, location: "Site B" },
      { ...base, name: "Hammer", category: "Hand Tools", status: "IN_WAREHOUSE", location: "Main Warehouse" },
    ];
    expect(summarizeToolCategories(rows).SCAFFOLD).toEqual({ tools: 102, inWarehouse: 80, onSite: 20, attention: 2 });
    expect(summarizeToolCategories(rows).HAND.tools).toBe(1);
    expect(countByWarehouse(rows).MAIN).toBe(103);
    expect(toolFilterCounts(rows).warehouse).toBe(81);
    expect(toolFilterCounts(rows).site).toBe(20);
  });
});
