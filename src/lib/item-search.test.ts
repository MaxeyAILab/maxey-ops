import { describe, expect, it } from "vitest";
import { filterItems, matchScore, recentItems, type PickItem } from "./item-search";

const item = (id: string, name: string, category = "PLUMBING", qty = 5): PickItem => ({ id, name, unit: "pcs", category, qty });
const stock = [
  item("1", 'PVC Pipe 1 -1/2" (Blue)'),
  item("2", 'PVC Pipe 1" (Blue)'),
  item("3", 'PVC Pipe 2"'),
  item("4", 'PVC Pipe 2" (Blue)'),
  item("5", 'PVC Pipe 12"'),
  item("6", 'PVC Tee 2"x2"'),
  item("7", "Portland cement", "CIVIL_ARCHITECTURAL"),
  item("8", "THHN wire 3.5mm", "ELECTRICAL", 0),
  item("9", 'PVC Pipe 1/2" (conduit)', "ELECTRICAL"),
];
const names = (r: { matches: PickItem[] }) => r.matches.map((i) => i.name);

describe("finding an item by typing", () => {
  it("every word must be in the name, in any order", () => {
    expect(names(filterItems(stock, { query: "cement" }))).toEqual(["Portland cement"]);
    expect(names(filterItems(stock, { query: "blue 2" }))).toEqual(['PVC Pipe 2" (Blue)', 'PVC Pipe 1 -1/2" (Blue)']);
    expect(names(filterItems(stock, { query: "pvc tee" }))).toEqual(['PVC Tee 2"x2"']);
  });

  it("is not fussy about capital letters", () => {
    expect(names(filterItems(stock, { query: "PORTLAND" }))).toEqual(["Portland cement"]);
  });

  it("finds sizes however they were typed — quotes and dashes do not matter", () => {
    expect(names(filterItems(stock, { query: "1-1/2" }))).toEqual(['PVC Pipe 1 -1/2" (Blue)']);
    expect(names(filterItems(stock, { query: '1 -1/2"' }))[0]).toBe('PVC Pipe 1 -1/2" (Blue)');
    expect(names(filterItems(stock, { query: "1/2" }))).toContain('PVC Pipe 1/2" (conduit)');
  });

  it("puts names that start with what was typed first", () => {
    expect(names(filterItems(stock, { query: "pvc pipe 2" }))[0]).toBe('PVC Pipe 2"');
    expect(matchScore("Portland cement", "port")).toBe(0);
    expect(matchScore("Portland cement", "cem")).toBe(1);
    expect(matchScore("Portland cement", "land")).toBe(2);
    expect(matchScore("Portland cement", "xyz")).toBeNull();
  });

  it("can be narrowed to one category, with or without typing", () => {
    expect(names(filterItems(stock, { category: "ELECTRICAL" }))).toEqual(['PVC Pipe 1/2" (conduit)', "THHN wire 3.5mm"]);
    expect(names(filterItems(stock, { query: "pvc", category: "ELECTRICAL" }))).toEqual(['PVC Pipe 1/2" (conduit)']);
    expect(filterItems(stock, { query: "cement", category: "PLUMBING" }).total).toBe(0);
  });

  it("lists everything alphabetically (numbers in order) when nothing is typed", () => {
    const all = names(filterItems(stock, {}));
    expect(all).toHaveLength(stock.length);
    expect(all[0]).toBe("Portland cement");
    expect(all.indexOf('PVC Pipe 2"')).toBeLessThan(all.indexOf('PVC Pipe 12"')); // 2 before 12, not after
  });

  it("shows a limited number but says how many matched", () => {
    const many = Array.from({ length: 120 }, (_, i) => item(String(i), `Bolt ${i}`));
    const r = filterItems(many, { query: "bolt", limit: 50 });
    expect(r.matches).toHaveLength(50);
    expect(r.total).toBe(120);
  });

  it("returns nothing for a query that matches nothing", () => {
    expect(filterItems(stock, { query: "zzzz" })).toEqual({ matches: [], total: 0 });
  });
});

describe("recent items", () => {
  it("lists what the person used last, newest first, without repeats", () => {
    expect(recentItems(["3", "7", "3", "1"], stock).map((i) => i.id)).toEqual(["3", "7", "1"]);
  });

  it("skips items that no longer exist and respects the limit", () => {
    expect(recentItems(["gone", "2", "1"], stock).map((i) => i.id)).toEqual(["2", "1"]);
    expect(recentItems(["1", "2", "3", "4"], stock, 2).map((i) => i.id)).toEqual(["1", "2"]);
    expect(recentItems([], stock)).toEqual([]);
  });
});
