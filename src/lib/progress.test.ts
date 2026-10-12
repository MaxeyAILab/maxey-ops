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
