import { describe, expect, it } from "vitest";
import { MATERIAL_CATEGORIES, MATERIAL_CATEGORY_LABEL, categoryFromSlug, categorySlug, isMaterialCategory, summarizeByCategory } from "./material-category";

describe("material categories", () => {
  it("are the four groups, in this order", () => {
    expect(MATERIAL_CATEGORIES.map((c) => c.label)).toEqual(["Civil & Architectural", "Plumbing", "Electrical", "Others (Mechanical etc.)"]);
    expect(MATERIAL_CATEGORIES.map((c) => c.value)).toEqual(["CIVIL_ARCHITECTURAL", "PLUMBING", "ELECTRICAL", "OTHERS"]);
  });

  it("recognises only those four", () => {
    for (const c of MATERIAL_CATEGORIES) expect(isMaterialCategory(c.value)).toBe(true);
    for (const v of ["civil", "MECHANICAL", "", null, undefined, 1]) expect(isMaterialCategory(v)).toBe(false);
  });

  it("has a label for each", () => {
    expect(MATERIAL_CATEGORY_LABEL.PLUMBING).toBe("Plumbing");
    expect(MATERIAL_CATEGORY_LABEL.OTHERS).toBe("Others (Mechanical etc.)");
  });

  it("turns the page address into a category and back", () => {
    for (const c of MATERIAL_CATEGORIES) {
      expect(categoryFromSlug(c.slug)).toBe(c.value);
      expect(categorySlug(c.value)).toBe(c.slug);
    }
    expect(categoryFromSlug("plumbing")).toBe("PLUMBING");
    for (const bad of ["", "PLUMBING", "tools", null, undefined]) expect(categoryFromSlug(bad as string)).toBeNull();
  });

  it("counts items per category and how many are out of stock", () => {
    const s = summarizeByCategory([
      { category: "PLUMBING", currentQty: 10 },
      { category: "PLUMBING", currentQty: 0 },
      { category: "ELECTRICAL", currentQty: 3 },
      { category: "OTHERS", currentQty: 0 },
      { category: "SOMETHING_OLD", currentQty: 4 }, // anything unrecognised counts as Others
    ]);
    expect(s.PLUMBING).toEqual({ items: 2, outOfStock: 1 });
    expect(s.ELECTRICAL).toEqual({ items: 1, outOfStock: 0 });
    expect(s.CIVIL_ARCHITECTURAL).toEqual({ items: 0, outOfStock: 0 });
    expect(s.OTHERS).toEqual({ items: 2, outOfStock: 1 });
  });
});
