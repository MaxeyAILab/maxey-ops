import { currentBreakdown, currentWeight, checkBreakdown } from "./progress";
import { describe, expect, it } from "vitest";
import {
  approvedWeight,
  checkWeightRules,
  computeWorkItemStatuses,
  summarizeProgress,
  weightedAccomplishment,
  weightTotal,
  type ProgressEntryLike,
} from "./progress";

const d = (day: number) => new Date(`2026-10-${String(day).padStart(2, "0")}T08:00:00Z`);
const entry = (
  workItem: string,
  weight: number,
  pct: number,
  day: number,
  reviewStatus: ProgressEntryLike["reviewStatus"] = "APPROVED"
): ProgressEntryLike => ({ workItem, weight, pctComplete: pct, createdAt: d(day), reviewStatus });

describe("verified progress", () => {
  it("counts only approved entries", () => {
    const entries = [entry("Footing", 40, 50, 1), entry("Footing", 40, 100, 2, "SUBMITTED"), entry("Walls", 60, 20, 1, "QUERIED")];
    const statuses = computeWorkItemStatuses(entries);
    expect(statuses).toHaveLength(1);
    expect(statuses[0].pctComplete).toBe(50);
    // 40% weight × 50% done = 20% of the project
    expect(weightedAccomplishment(statuses)).toBeCloseTo(20);
  });

  it("uses the latest approved entry per work item", () => {
    const entries = [entry("Footing", 40, 30, 1), entry("Footing", 40, 70, 3)];
    expect(weightedAccomplishment(computeWorkItemStatuses(entries))).toBeCloseTo(28);
  });

  it("does not renormalise when weights total under 100", () => {
    // Only 50% of scope is defined; finishing it is 50% overall, not 100%.
    expect(weightedAccomplishment(computeWorkItemStatuses([entry("A", 50, 100, 1)]))).toBeCloseTo(50);
  });

  it("ignores entries without a work item or weight", () => {
    const entries: ProgressEntryLike[] = [
      { workItem: null, weight: 10, pctComplete: 100, createdAt: d(1), reviewStatus: "APPROVED" },
      { workItem: "A", weight: null, pctComplete: 100, createdAt: d(1), reviewStatus: "APPROVED" },
    ];
    expect(computeWorkItemStatuses(entries)).toHaveLength(0);
  });
});

describe("summarizeProgress", () => {
  it("reports submitted work separately from verified work", () => {
    const entries = [entry("Footing", 40, 50, 1), entry("Footing", 40, 100, 2, "SUBMITTED"), entry("Walls", 60, 10, 2, "QUERIED")];
    const s = summarizeProgress(entries);
    expect(s.verifiedPct).toBeCloseTo(20);
    expect(s.submittedPct).toBeCloseTo(40); // queried work never counts as submitted progress
    expect(s.pendingCount).toBe(1);
    expect(s.queriedCount).toBe(1);
  });

  it("reports last verified time from the review time when present", () => {
    const reviewedAt = new Date("2026-10-09T10:00:00Z");
    const s = summarizeProgress([{ ...entry("A", 100, 10, 1), reviewedAt }, entry("A", 100, 20, 2, "SUBMITTED")]);
    expect(s.lastVerifiedAt).toEqual(reviewedAt);
  });

  it("has no verified time when nothing is approved", () => {
    expect(summarizeProgress([entry("A", 100, 10, 1, "SUBMITTED")]).lastVerifiedAt).toBeNull();
  });
});

describe("weights", () => {
  const entries = [
    { id: "1", workItem: "A", weight: 40, createdAt: d(1) },
    { id: "2", workItem: "B", weight: 30, createdAt: d(1) },
    { id: "3", workItem: "A", weight: 40, createdAt: d(2) },
  ];

  it("sums each item's current weight once", () => {
    expect(weightTotal(entries)).toBe(70);
  });

  it("includes a proposed new item", () => {
    expect(weightTotal(entries, { workItem: "C", weight: 35 })).toBe(105);
  });

  it("replaces an item's weight rather than adding to it", () => {
    expect(weightTotal(entries, { workItem: "A", weight: 50 })).toBe(80);
  });

  it("excludes the entry being edited", () => {
    expect(weightTotal(entries, { workItem: "B", weight: 10, excludeId: "2" })).toBe(50);
  });

  it("finds the approved weight for an item", () => {
    const list = [
      { workItem: "A", weight: 40, createdAt: d(1), reviewStatus: "APPROVED" as const },
      { workItem: "A", weight: 45, createdAt: d(2), reviewStatus: "SUBMITTED" as const },
    ];
    expect(approvedWeight(list, "A")).toBe(40);
    expect(approvedWeight(list, "Z")).toBeNull();
  });
});

describe("checkWeightRules", () => {
  const list = [
    { id: "1", workItem: "A", weight: 60, createdAt: d(1), reviewStatus: "APPROVED" as const },
    { id: "2", workItem: "B", weight: 30, createdAt: d(1), reviewStatus: "SUBMITTED" as const },
  ];

  it("locks an approved item's weight against non-approvers", () => {
    expect(checkWeightRules(list, { workItem: "A", weight: 50 }, false)).toMatch(/locked at 60%/);
    expect(checkWeightRules(list, { workItem: "A", weight: 60 }, false)).toBeNull();
  });

  it("lets PM/Owner change a locked weight", () => {
    expect(checkWeightRules(list, { workItem: "A", weight: 55 }, true)).toBeNull();
  });

  it("does not lock a weight that was never approved", () => {
    expect(checkWeightRules(list, { workItem: "B", weight: 35 }, false)).toBeNull();
  });

  it("blocks a new item that pushes the total past 100", () => {
    expect(checkWeightRules(list, { workItem: "C", weight: 20 }, false)).toMatch(/exceed 100%/);
    expect(checkWeightRules(list, { workItem: "C", weight: 10 }, false)).toBeNull();
  });

  it("tolerates existing over-100 data when an entry does not make it worse", () => {
    const bad = [
      { id: "1", workItem: "A", weight: 70, createdAt: d(1), reviewStatus: "APPROVED" as const },
      { id: "2", workItem: "B", weight: 50, createdAt: d(1), reviewStatus: "APPROVED" as const },
    ];
    expect(checkWeightRules(bad, { workItem: "B", weight: 50 }, false)).toBeNull();
    expect(checkWeightRules(bad, { workItem: "C", weight: 5 }, false)).toMatch(/exceed 100%/);
  });

  it("ignores entries without a work item or weight", () => {
    expect(checkWeightRules(list, { workItem: "", weight: 90 }, false)).toBeNull();
    expect(checkWeightRules(list, { workItem: "A", weight: null }, false)).toBeNull();
  });

  it("excludes the edited entry when checking the total", () => {
    expect(checkWeightRules(list, { workItem: "B", weight: 40, excludeId: "2" }, false)).toBeNull();
    expect(checkWeightRules(list, { workItem: "B", weight: 45, excludeId: "2" }, false)).toMatch(/exceed 100%/);
  });
});

describe("work items broken into sub-items", () => {
  const t = (n: number) => new Date(`2026-10-${String(n).padStart(2, "0")}T08:00:00Z`);
  const sub = (item: string, subItem: string, subWeight: number, pct: number, day: number, over: Record<string, unknown> = {}) => ({
    workItem: item, weight: 40, subItem, subWeight, pctComplete: pct, createdAt: t(day), reviewStatus: "APPROVED" as const, color: "#ec4899", ...over,
  });
  const whole = (item: string, weight: number, pct: number, day: number, over: Record<string, unknown> = {}) => ({
    workItem: item, weight, pctComplete: pct, createdAt: t(day), reviewStatus: "APPROVED" as const, ...over,
  });
  const earth = [sub("Earthfilling", "Earthfill materials", 15, 100, 5), sub("Earthfilling", "Spreading", 10, 50, 5), sub("Earthfilling", "Compaction", 15, 0, 5)];

  it("the main item's completion is the weighted average of its sub-items", () => {
    const [it] = computeWorkItemStatuses(earth);
    expect(it.weight).toBe(40);
    expect(it.pctComplete).toBe(50); // (15×100 + 10×50 + 15×0) / 40
    expect(it.subItems?.map((s) => [s.name, s.weight, s.pctComplete])).toEqual([["Compaction", 15, 0], ["Earthfill materials", 15, 100], ["Spreading", 10, 50]]);
  });
  it("the project total is the same sum as before (weight × completion), so the chart and the total still agree", () => {
    const statuses = computeWorkItemStatuses([...earth, whole("Demolition", 20, 60, 6)]);
    expect(weightedAccomplishment(statuses)).toBeCloseTo(20 + 12, 5); // 40×50% + 20×60%
  });
  it("uses each sub-item's latest approved report", () => {
    const later = [...earth, sub("Earthfilling", "Compaction", 15, 80, 9)];
    expect(computeWorkItemStatuses(later)[0].pctComplete).toBeCloseTo((1500 + 500 + 1200) / 40, 5);
  });
  it("an unapproved report does not count until it is approved", () => {
    const pending = [...earth, sub("Earthfilling", "Compaction", 15, 100, 9, { reviewStatus: "SUBMITTED" })];
    expect(computeWorkItemStatuses(pending)[0].pctComplete).toBe(50);
    expect(summarizeProgress(pending).submittedPct).toBeCloseTo(40 * ((1500 + 500 + 1500) / 40) / 100, 5);
  });
  it("until the breakdown is approved the item keeps the whole-item figure it had", () => {
    const entries = [whole("Earthfilling", 40, 70, 1), ...earth.map((e) => ({ ...e, reviewStatus: "SUBMITTED" as const }))];
    expect(computeWorkItemStatuses(entries)[0].pctComplete).toBe(70);
  });
  it("once it has sub-items, older whole-item reports no longer decide its completion", () => {
    const entries = [whole("Earthfilling", 40, 70, 1), ...earth];
    expect(computeWorkItemStatuses(entries)[0].pctComplete).toBe(50);
  });
  it("a removed sub-item (weight 0) drops out; with none left the item goes back to its whole-item figure", () => {
    const removed = [...earth, sub("Earthfilling", "Spreading", 0, 0, 8)];
    const only = computeWorkItemStatuses([...removed.slice(0, 1), ...removed.slice(2)]);
    expect(only[0].subItems?.map((s) => s.name)).toEqual(["Compaction", "Earthfill materials"]);
    const gone = computeWorkItemStatuses([whole("Earthfilling", 40, 70, 1), sub("Earthfilling", "A", 0, 0, 5), sub("Earthfilling", "B", 0, 0, 5), whole("Earthfilling", 40, 55, 6)]);
    expect(gone[0].pctComplete).toBe(55);
    expect(gone[0].subItems).toBeUndefined();
  });
  it("lists current sub-items and the main weight, latest entry of any status", () => {
    expect(currentBreakdown(earth, "Earthfilling").map((b) => b.name)).toEqual(["Compaction", "Earthfill materials", "Spreading"]);
    expect(currentBreakdown(earth, "Other")).toEqual([]);
    expect(currentWeight(earth, "Earthfilling")).toBe(40);
  });
});

describe("rules for setting sub-items", () => {
  const entries = [{ workItem: "Earthfilling", weight: 40, createdAt: new Date("2026-10-01T00:00:00Z") }, { workItem: "Demolition", weight: 20, createdAt: new Date("2026-10-01T00:00:00Z") }];
  const ok = { workItem: "Earthfilling", weight: 40, items: [{ name: "Materials", weight: 15 }, { name: "Spreading", weight: 10 }, { name: "Compaction", weight: 15 }] };
  it("allows sub-items that add up exactly to the main item's weight", () => expect(checkBreakdown(entries, ok)).toBeNull());
  it("refuses sub-items that do not add up, and says by how much", () => {
    expect(checkBreakdown(entries, { ...ok, items: [{ name: "A", weight: 15 }, { name: "B", weight: 10 }] })).toMatch(/add up to 25%.*exactly 40%/);
  });
  it("needs at least two sub-items, unique names and weights above zero", () => {
    expect(checkBreakdown(entries, { ...ok, items: [{ name: "A", weight: 40 }] })).toMatch(/at least two/);
    expect(checkBreakdown(entries, { ...ok, items: [{ name: "A", weight: 20 }, { name: " a ", weight: 20 }] })).toMatch(/twice/);
    expect(checkBreakdown(entries, { ...ok, items: [{ name: "A", weight: 40 }, { name: "B", weight: 0 }] })).toMatch(/above zero/);
    expect(checkBreakdown(entries, { ...ok, items: [{ name: "", weight: 20 }, { name: "B", weight: 20 }] })).toMatch(/name/);
  });
  it("taking the breakdown away (no sub-items) is allowed", () => expect(checkBreakdown(entries, { ...ok, items: [] })).toBeNull());
  it("cannot push the project past 100%", () => {
    const big = { workItem: "Earthfilling", weight: 90, items: [{ name: "A", weight: 45 }, { name: "B", weight: 45 }] };
    expect(checkBreakdown(entries, big)).toMatch(/100%/);
  });
});
