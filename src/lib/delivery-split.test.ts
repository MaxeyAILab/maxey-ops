import { describe, expect, it } from "vitest";
import { combinedChecklist, discrepancyLines, dueQty, planAdjustment, poFullyReceived, remainingOnPo, type ChecklistRow, type PoLine } from "./delivery-adjust";

// PO-2026-0064 as it is in the live system (names with the trailing spaces they were saved with)
const po: PoLine[] = [
  { name: "G.I. Roofing Sheet (3.6m length) ", qty: 6, unit: "pcs", unitCost: 782 },
  { name: "End Flashing (8ft) ", qty: 3, unit: "pcs", unitCost: 232 },
  { name: "G.I. Roofing Sheet (3m length) ", qty: 5, unit: "pcs", unitCost: 651 },
  { name: "Electrical Tape", qty: 2, unit: "pcs", unitCost: 45 },
  { name: "Baby roller", qty: 1, unit: "pc", unitCost: 45 },
  { name: 'Paint Brush 2"', qty: 1, unit: "pc", unitCost: 35 },
];
const row = (item: string, orderedQty: number, receivedQty: number, alreadyReceived?: number, ok = true): ChecklistRow => ({ item, orderedQty, receivedQty, ok, alreadyReceived });

// first truck: only the small items came
const truck1: ChecklistRow[] = [
  row("G.I. Roofing Sheet (3.6m length) ", 6, 0),
  row("End Flashing (8ft) ", 3, 0),
  row("G.I. Roofing Sheet (3m length) ", 5, 0),
  row("Electrical Tape", 2, 2),
  row("Baby roller", 1, 1),
  row('Paint Brush 2"', 1, 1),
];

describe("a PO delivered on more than one truck", () => {
  it("after the first truck, only the roofing and flashing are still to come", () => {
    const left = remainingOnPo(po, [truck1]);
    expect(left.map((l) => [l.alreadyReceived, l.due])).toEqual([[0, 6], [0, 3], [0, 5], [2, 0], [1, 0], [1, 0]]);
    expect(poFullyReceived(po, [truck1])).toBe(false);
  });

  it("the second truck bringing the rest (0 for what already came) tallies and completes the PO", () => {
    const truck2 = [
      row("G.I. Roofing Sheet (3.6m length) ", 6, 6, 0),
      row("End Flashing (8ft) ", 3, 3, 0),
      row("G.I. Roofing Sheet (3m length) ", 5, 5, 0),
      row("Electrical Tape", 2, 0, 2),
      row("Baby roller", 1, 0, 1),
      row('Paint Brush 2"', 1, 0, 1),
    ];
    expect(discrepancyLines(truck2)).toEqual([]);
    expect(poFullyReceived(po, [truck1, truck2])).toBe(true);
  });

  it("a second truck that is still short says what was received before", () => {
    const truck2 = [row("G.I. Roofing Sheet (3.6m length) ", 6, 4, 0), row("Electrical Tape", 2, 0, 2)];
    expect(discrepancyLines(truck2)).toEqual(["G.I. Roofing Sheet (3.6m length) : ordered 6, received 4"]);
    expect(discrepancyLines([row("Cement", 10, 3, 5)])).toEqual(["Cement: ordered 10, 5 received before, received 3 now"]);
    expect(dueQty(row("Cement", 10, 0, 12))).toBe(0);
  });

  it("an item not in good order does not count toward completing the PO", () => {
    const truck2 = [row("G.I. Roofing Sheet (3.6m length) ", 6, 6, 0, false), row("End Flashing (8ft) ", 3, 3, 0), row("G.I. Roofing Sheet (3m length) ", 5, 5, 0)];
    expect(poFullyReceived(po, [truck1, truck2])).toBe(false);
    expect(discrepancyLines(truck2)).toHaveLength(1);
  });

  it("accepting as complete keeps what the first truck brought and drops only what never came", () => {
    const truck2 = [row("G.I. Roofing Sheet (3.6m length) ", 6, 6, 0), row("End Flashing (8ft) ", 3, 0, 0), row("G.I. Roofing Sheet (3m length) ", 5, 5, 0), row("Electrical Tape", 2, 0, 2), row("Baby roller", 1, 0, 1), row('Paint Brush 2"', 1, 0, 1)];
    const plan = planAdjustment(po, combinedChecklist([truck1, truck2]));
    expect(plan.lines.map((l) => [l.item.trim(), l.from, l.to])).toEqual([["End Flashing (8ft)", 3, 0]]);
    expect(plan.totalBefore).toBe(8813);
    expect(plan.totalAfter).toBe(8813 - 3 * 232);
  });

  it("accepting after the first truck only (nothing more is coming) cuts the PO to the small items", () => {
    const plan = planAdjustment(po, combinedChecklist([truck1]));
    expect(plan.totalAfter).toBe(2 * 45 + 45 + 35);
  });
});
