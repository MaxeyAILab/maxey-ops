import { describe, expect, it } from "vitest";
import { computeForecast } from "./forecast";
import { computeSchedule } from "./schedule";

describe("computeForecast", () => {
  it("never reports a margin when no cost is recorded (the 100% margin trap)", () => {
    const f = computeForecast({ contract: 1_000_000, committed: 0, pct: 40, isCompleted: false });
    expect(f.costState).toBe("no-cost");
    expect(f.forecastCost).toBeNull();
    expect(f.forecastMarginPct).toBeNull();
  });

  it("reports no forecast before any verified progress", () => {
    const f = computeForecast({ contract: 1_000_000, committed: 200_000, pct: 0, isCompleted: false });
    expect(f.costState).toBe("no-progress");
    expect(f.forecastMarginPct).toBeNull();
  });

  it("extrapolates cost to date over verified progress", () => {
    const f = computeForecast({ contract: 1_000_000, committed: 300_000, pct: 50, isCompleted: false });
    expect(f.costState).toBe("ok");
    expect(f.forecastCost).toBeCloseTo(600_000);
    expect(f.forecastProfit).toBeCloseTo(400_000);
    expect(f.forecastMarginPct).toBeCloseTo(40);
  });

  it("flags under 10% complete as an early estimate", () => {
    expect(computeForecast({ contract: 1_000_000, committed: 20_000, pct: 5, isCompleted: false }).costState).toBe("early");
  });

  it("does not project beyond committed cost at 100%", () => {
    expect(computeForecast({ contract: 1_000_000, committed: 700_000, pct: 100, isCompleted: false }).forecastCost).toBe(700_000);
  });

  it("uses committed cost as the final cost for completed projects, but not when it is zero", () => {
    expect(computeForecast({ contract: 100, committed: 60, pct: 100, isCompleted: true }).costState).toBe("final");
    expect(computeForecast({ contract: 100, committed: 0, pct: 100, isCompleted: true }).forecastMarginPct).toBeNull();
  });

  it("shows a loss as a negative margin", () => {
    const f = computeForecast({ contract: 1_000_000, committed: 800_000, pct: 50, isCompleted: false });
    expect(f.forecastMarginPct).toBeCloseTo(-60);
  });

  it("returns no margin for a zero contract", () => {
    expect(computeForecast({ contract: 0, committed: 10, pct: 50, isCompleted: false }).forecastMarginPct).toBeNull();
  });
});

describe("computeSchedule", () => {
  const now = new Date("2026-10-12T00:00:00Z");
  const days = (n: number) => new Date(now.getTime() + n * 86_400_000);

  it("is overdue past the target finish", () => {
    const s = computeSchedule({ now, start: days(-100), targetEnd: days(-5), pct: 80, isCompleted: false });
    expect(s.state).toBe("overdue");
    expect(s.varianceDays).toBe(5);
  });

  it("is not overdue once the project is complete", () => {
    expect(computeSchedule({ now, start: days(-100), targetEnd: days(-5), pct: 100, isCompleted: true }).state).toBe("done");
  });

  it("has no state without a target date", () => {
    expect(computeSchedule({ now, start: days(-10), targetEnd: null, pct: 10, isCompleted: false }).state).toBe("no-target");
  });

  it("judges by time used versus work done", () => {
    // 60 of 100 days used, 20% done → 40-point gap → late
    expect(computeSchedule({ now, start: days(-60), targetEnd: days(40), pct: 20, isCompleted: false }).state).toBe("late");
    // 60% of time, 40% done → 20-point gap → watch
    expect(computeSchedule({ now, start: days(-60), targetEnd: days(40), pct: 40, isCompleted: false }).state).toBe("watch");
    expect(computeSchedule({ now, start: days(-60), targetEnd: days(40), pct: 55, isCompleted: false }).state).toBe("on-plan");
  });

  it("does not forecast a finish date before 25% progress", () => {
    const s = computeSchedule({ now, start: days(-60), targetEnd: days(40), pct: 15, isCompleted: false });
    expect(s.forecastFinish).toBeNull();
    expect(s.varianceDays).toBeNull();
  });

  it("handles a start date in the future", () => {
    expect(computeSchedule({ now, start: days(10), targetEnd: days(100), pct: 0, isCompleted: false }).state).toBe("unknown");
  });
});
