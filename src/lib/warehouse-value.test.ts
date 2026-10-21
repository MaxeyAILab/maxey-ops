import { describe, expect, it } from "vitest";
import { issuedFromWarehouse, lineValue, parsePrice, summarizeValue } from "./warehouse-value";

describe("value of one stock line", () => {
  it("is quantity times price, to the centavo", () => {
    expect(lineValue(8, 150)).toBe(1200);
    expect(lineValue("12.5", "19.99")).toBe(249.88);
    expect(lineValue(0, 50)).toBe(0);
  });

  it("has no value when no price was entered (not zero)", () => {
    expect(lineValue(10, null)).toBeNull();
    expect(lineValue(10, undefined)).toBeNull();
    expect(lineValue(10, "")).toBeNull();
  });

  it("treats a price of 0 as a real price", () => {
    expect(lineValue(10, 0)).toBe(0);
  });
});

describe("value of the warehouse", () => {
  const items = [
    { category: "PLUMBING", currentQty: 10, unitPrice: 100 }, // 1000
    { category: "PLUMBING", currentQty: 5, unitPrice: "20.50" }, // 102.50
    { category: "PLUMBING", currentQty: 7, unitPrice: null }, // not counted
    { category: "ELECTRICAL", currentQty: 2, unitPrice: 1500 }, // 3000
    { category: "CIVIL_ARCHITECTURAL", currentQty: 0, unitPrice: 300 }, // 0
    { category: "OLD_VALUE", currentQty: 3, unitPrice: 10 }, // counts as Others: 30
  ];

  it("adds up what has a price and says how many do not", () => {
    const s = summarizeValue(items);
    expect(s.total).toBe(4132.5);
    expect(s.priced).toBe(5);
    expect(s.unpriced).toBe(1);
  });

  it("splits it by category", () => {
    const s = summarizeValue(items);
    expect(s.byCategory.PLUMBING).toEqual({ value: 1102.5, items: 3, unpriced: 1 });
    expect(s.byCategory.ELECTRICAL).toEqual({ value: 3000, items: 1, unpriced: 0 });
    expect(s.byCategory.CIVIL_ARCHITECTURAL).toEqual({ value: 0, items: 1, unpriced: 0 });
    expect(s.byCategory.OTHERS).toEqual({ value: 30, items: 1, unpriced: 0 });
  });

  it("is zero for an empty warehouse", () => {
    expect(summarizeValue([])).toMatchObject({ total: 0, priced: 0, unpriced: 0 });
  });
});

describe("reading a typed price", () => {
  it("accepts ordinary prices, with commas, the peso sign and spaces", () => {
    expect(parsePrice("150")).toBe(150);
    expect(parsePrice(" 1,250.50 ")).toBe(1250.5);
    expect(parsePrice("₱75.5")).toBe(75.5);
    expect(parsePrice("0")).toBe(0);
  });

  it("treats blank as no price", () => {
    expect(parsePrice("")).toBeNull();
    expect(parsePrice("   ")).toBeNull();
  });

  it("refuses anything that is not a price", () => {
    for (const bad of ["abc", "-5", "1.234", "12..5", "1e3", "999999999999"]) expect(parsePrice(bad), bad).toBeUndefined();
  });
});

describe("what has gone out of the warehouse", () => {
  const monthStart = new Date("2026-10-01T00:00:00+08:00");
  const mv = (type: string, qty: number, unitPrice: number | null, at: string, status = "APPLIED") => ({ type, status, qty, unitPrice, createdAt: new Date(at) });

  it("adds up issues to sites, this month and all time, at the price remembered when they were logged", () => {
    const s = issuedFromWarehouse(
      [
        mv("WAREHOUSE_TO_SITE", 10, 100, "2026-10-05T08:00:00+08:00"), // 1000 this month
        mv("WAREHOUSE_TO_SITE", 2, 250.5, "2026-10-20T08:00:00+08:00"), // 501 this month
        mv("WAREHOUSE_TO_SITE", 4, 50, "2026-09-15T08:00:00+08:00"), // 200 last month
      ],
      monthStart
    );
    expect(s).toEqual({ monthValue: 1501, monthCount: 2, allValue: 1701, allCount: 3, unpriced: 0 });
  });

  it("counts only issues from the warehouse that were applied", () => {
    const s = issuedFromWarehouse(
      [
        mv("WAREHOUSE_TO_SITE", 1, 100, "2026-10-05T08:00:00+08:00", "PENDING"),
        mv("WAREHOUSE_TO_SITE", 1, 100, "2026-10-05T08:00:00+08:00", "REJECTED"),
        mv("SITE_TO_WAREHOUSE", 5, 100, "2026-10-05T08:00:00+08:00"),
        mv("CONSUMED_ON_SITE", 5, 100, "2026-10-05T08:00:00+08:00"),
        mv("SUPPLIER_TO_WAREHOUSE", 5, 100, "2026-10-05T08:00:00+08:00"),
      ],
      monthStart
    );
    expect(s).toEqual({ monthValue: 0, monthCount: 0, allValue: 0, allCount: 0, unpriced: 0 });
  });

  it("reports issues that had no price instead of treating them as free", () => {
    const s = issuedFromWarehouse([mv("WAREHOUSE_TO_SITE", 3, null, "2026-10-05T08:00:00+08:00"), mv("WAREHOUSE_TO_SITE", 1, 40, "2026-10-06T08:00:00+08:00")], monthStart);
    expect(s).toEqual({ monthValue: 40, monthCount: 2, allValue: 40, allCount: 2, unpriced: 1 });
  });
});
