import { describe, expect, it } from "vitest";
import { contractLock, locksCost } from "./project-cost";

describe("when the project cost can still be revised", () => {
  it("is open while the project is being set up (Site Survey, Mobilization, Not Active, On hold)", () => {
    for (const status of ["SITE_SURVEY", "MOBILIZATION", "NOT_ACTIVE", "ON_HOLD"] as const) {
      expect(contractLock({ status, costLockedAt: null }).locked, status).toBe(false);
    }
  });
  it("is final once construction has started (On-going Construction, Punchlist, Turned-over)", () => {
    for (const status of ["ONGOING_CONSTRUCTION", "FOR_PUNCHLIST", "TURNED_OVER"] as const) {
      const lock = contractLock({ status, costLockedAt: null });
      expect(lock.locked, status).toBe(true);
      expect(lock.message).toMatch(/change order/);
      expect(locksCost(status)).toBe(true);
    }
  });
  it("stays final even if the status is moved back to Mobilization or On hold", () => {
    expect(contractLock({ status: "MOBILIZATION", costLockedAt: new Date() }).locked).toBe(true);
    expect(contractLock({ status: "ON_HOLD", costLockedAt: "2026-11-03T00:00:00Z" }).locked).toBe(true);
  });
});
