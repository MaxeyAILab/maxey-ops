import { describe, expect, it } from "vitest";
import { filterTools, isToolFilter, needsAttention, toolFilterCounts, type ToolRow } from "./tool-filter";

const t = (name: string, over: Partial<ToolRow> = {}): ToolRow => ({ name, assetTag: null, category: null, status: "IN_WAREHOUSE", workingStatus: "WORKING", location: "Warehouse", ...over });
const tools: ToolRow[] = [
  t("Trowel", { assetTag: "TR-001", category: "Power Tool" }),
  t("Trowel", { assetTag: "TR-002", status: "ON_SITE", location: "Calauan Market" }),
  t("Trowel Engine", { assetTag: "TRE-001", category: "Power Tool", workingStatus: "FOR_REPAIR" }),
  t("Mixer with 2 Engines", { category: "Heavy Equipment", status: "ON_SITE", location: "Road Concreting" }),
  t("Old generator", { workingStatus: "FOR_DISPOSAL" }),
  t("Welding machine", { status: "LOST", location: "Calauan Market" }),
];
const tags = (rows: ToolRow[]) => rows.map((r) => r.assetTag ?? r.name);

describe("narrowing the tools list", () => {
  it("by where the tool is", () => {
    expect(tags(filterTools(tools, "warehouse", ""))).toEqual(["TR-001", "TRE-001", "Old generator"]);
    expect(tags(filterTools(tools, "site", ""))).toEqual(["TR-002", "Mixer with 2 Engines"]);
  });

  it("by whether it needs attention (not working, for repair/disposal, under repair, lost)", () => {
    expect(tags(filterTools(tools, "attention", ""))).toEqual(["TRE-001", "Old generator", "Welding machine"]);
    expect(needsAttention(t("x", { status: "UNDER_REPAIR" }))).toBe(true);
    expect(needsAttention(t("x"))).toBe(false);
  });

  it("by typing — name, tag, category or location, any order", () => {
    expect(tags(filterTools(tools, "all", "engine"))).toEqual(["TRE-001", "Mixer with 2 Engines"]);
    expect(tags(filterTools(tools, "all", "tr-002"))).toEqual(["TR-002"]);
    expect(tags(filterTools(tools, "all", "tr002"))).toEqual(["TR-002"]);
    expect(tags(filterTools(tools, "all", "heavy"))).toEqual(["Mixer with 2 Engines"]);
    expect(tags(filterTools(tools, "all", "calauan"))).toEqual(["TR-002", "Welding machine"]);
    expect(tags(filterTools(tools, "all", "trowel power"))).toEqual(["TR-001", "TRE-001"]);
  });

  it("typing and a filter work together", () => {
    expect(tags(filterTools(tools, "site", "trowel"))).toEqual(["TR-002"]);
    expect(filterTools(tools, "warehouse", "calauan")).toEqual([]);
  });

  it("counts what each button would show", () => {
    expect(toolFilterCounts(tools)).toEqual({ all: 6, warehouse: 3, site: 2, attention: 3 });
  });

  it("recognises the filter names used in the page address", () => {
    for (const k of ["all", "warehouse", "site", "attention"]) expect(isToolFilter(k)).toBe(true);
    for (const k of ["", "lost", null, undefined]) expect(isToolFilter(k)).toBe(false);
  });
});
