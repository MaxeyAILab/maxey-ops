import { describe, expect, it } from "vitest";
import { byUrgencyThenNewest, requisitionTabOf } from "./requisitions";

describe("requisition tabs", () => {
  it("puts each status under its tab", () => {
    expect(requisitionTabOf("SUBMITTED")).toBe("submitted");
    expect(requisitionTabOf("UNDER_REVIEW")).toBe("submitted");
    expect(requisitionTabOf("APPROVED")).toBe("approved");
    expect(requisitionTabOf("PO_ISSUED")).toBe("po");
    expect(requisitionTabOf("DELIVERED")).toBe("delivered");
    expect(requisitionTabOf("REJECTED")).toBe("rejected");
  });

  it("lists Critical first, then High, Normal, Low — newest first within the same urgency", () => {
    const rows = [
      { id: "n-old", urgency: "NORMAL", submittedAt: new Date("2026-11-10") },
      { id: "h-old", urgency: "HIGH", submittedAt: new Date("2026-11-12") },
      { id: "c", urgency: "CRITICAL", submittedAt: new Date("2026-11-01") },
      { id: "l", urgency: "LOW", submittedAt: new Date("2026-11-17") },
      { id: "h-new", urgency: "HIGH", submittedAt: new Date("2026-11-17") },
      { id: "n-new", urgency: "NORMAL", submittedAt: new Date("2026-11-16") },
    ];
    expect(byUrgencyThenNewest(rows).map((r) => r.id)).toEqual(["c", "h-new", "h-old", "n-new", "n-old", "l"]);
  });
});
