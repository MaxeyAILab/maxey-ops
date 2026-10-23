import { describe, expect, it } from "vitest";
import { normalizeToolCategory, summarizeToolCategories, toolCategoryFromSlug, toolCategoryKey, toolCategorySlug } from "./tool-category";

describe("toolCategoryKey", () => {
  it("sorts the wording used so far into the four groups", () => {
    expect(toolCategoryKey("Power Tool")).toBe("POWER");
    expect(toolCategoryKey("Hand Tool")).toBe("HAND");
    expect(toolCategoryKey("Heavy Equipment")).toBe("HEAVY");
    expect(toolCategoryKey("Safety Equipment")).toBe("SAFETY");
  });

  it("ignores capital letters and plurals", () => {
    expect(toolCategoryKey("POWER TOOLS")).toBe("POWER");
    expect(toolCategoryKey("hand tools")).toBe("HAND");
  });

  it("puts anything else, or nothing, in 'not categorized'", () => {
    expect(toolCategoryKey("Welding")).toBe("NONE");
    expect(toolCategoryKey("")).toBe("NONE");
    expect(toolCategoryKey(null)).toBe("NONE");
    expect(toolCategoryKey(undefined)).toBe("NONE");
  });
});

describe("normalizeToolCategory", () => {
  it("gives the proper name to store", () => {
    expect(normalizeToolCategory("Power Tool")).toBe("Power Tools");
    expect(normalizeToolCategory(" hand tool ")).toBe("Hand Tools");
    expect(normalizeToolCategory("Heavy Equipment")).toBe("Heavy Equipment");
    expect(normalizeToolCategory("Safety equipment")).toBe("Safety Equipment");
  });

  it("empty clears the category; unknown text is refused", () => {
    expect(normalizeToolCategory("")).toBeNull();
    expect(normalizeToolCategory("   ")).toBeNull();
    expect(normalizeToolCategory(null)).toBeNull();
    expect(normalizeToolCategory("Gadgets")).toBeUndefined();
  });
});

describe("page-address slugs", () => {
  it("round-trip", () => {
    expect(toolCategoryFromSlug("power-tools")).toBe("POWER");
    expect(toolCategoryFromSlug("not-categorized")).toBe("NONE");
    expect(toolCategoryFromSlug("nonsense")).toBeNull();
    expect(toolCategoryFromSlug(undefined)).toBeNull();
    expect(toolCategorySlug("HEAVY")).toBe("heavy-equipment");
    expect(toolCategorySlug("NONE")).toBe("not-categorized");
  });
});

describe("summarizeToolCategories", () => {
  it("counts each group, where its tools are and which need attention", () => {
    const s = summarizeToolCategories([
      { category: "Power Tool", status: "IN_WAREHOUSE", workingStatus: "WORKING" },
      { category: "Power Tools", status: "ON_SITE", workingStatus: "WORKING" },
      { category: "Power Tool", status: "IN_WAREHOUSE", workingStatus: "FOR_REPAIR" },
      { category: "Hand Tool", status: "UNDER_REPAIR", workingStatus: "WORKING" },
      { category: null, status: "IN_WAREHOUSE", workingStatus: "WORKING" },
    ]);
    expect(s.POWER).toEqual({ tools: 3, inWarehouse: 2, onSite: 1, attention: 1 });
    expect(s.HAND).toEqual({ tools: 1, inWarehouse: 0, onSite: 0, attention: 1 });
    expect(s.NONE.tools).toBe(1);
    expect(s.HEAVY.tools).toBe(0);
    expect(s.SAFETY.tools).toBe(0);
  });
});
