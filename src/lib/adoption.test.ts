import { describe, expect, it } from "vitest";
import { dataQualityGaps, type DataQualityInput } from "./data-quality";
import { buildTemplateMilestones, MILESTONE_TEMPLATES } from "./milestone-templates";

const now = new Date("2026-10-12T04:00:00Z");
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

const healthy = (over: Partial<DataQualityInput> = {}): DataQualityInput => ({
  now,
  status: "ONGOING_CONSTRUCTION",
  startDate: d("2026-08-01"),
  targetEndDate: d("2027-01-31"),
  hasManager: true,
  milestoneCount: 5,
  milestonesWithBaseline: 5,
  progressEntryCount: 12,
  weightsTotal: 100,
  lastProgressAt: d("2026-10-10"),
  progressPct: 40,
  committed: 500_000,
  billingTermCount: 4,
  billingCoverage: "complete",
  billedWithoutDueDate: 0,
  closeoutTotal: 0,
  ...over,
});

describe("dataQualityGaps", () => {
  it("reports no gaps for a complete, current project", () => {
    const r = dataQualityGaps(healthy());
    expect(r.gaps).toEqual([]);
    expect(r.passed).toBe(r.checksRun);
    expect(r.checksRun).toBeGreaterThan(8);
  });

  it("flags missing dates, manager and milestones", () => {
    const keys = dataQualityGaps(healthy({ startDate: null, targetEndDate: null, hasManager: false, milestoneCount: 0, milestonesWithBaseline: 0 })).gaps.map((g) => g.key);
    expect(keys).toEqual(expect.arrayContaining(["start", "target", "pm", "milestones"]));
    expect(keys).not.toContain("baseline"); // can't lack a baseline on milestones that don't exist
  });

  it("flags milestones that have no approved baseline", () => {
    expect(dataQualityGaps(healthy({ milestonesWithBaseline: 0 })).gaps.map((g) => g.key)).toContain("baseline");
  });

  it("flags weights that do not total 100, escalating over 100", () => {
    const under = dataQualityGaps(healthy({ weightsTotal: 80 })).gaps.find((g) => g.key === "weights")!;
    const over = dataQualityGaps(healthy({ weightsTotal: 120 })).gaps.find((g) => g.key === "weights")!;
    expect([under.severity, over.severity]).toEqual([1, 2]);
    expect(dataQualityGaps(healthy({ weightsTotal: null })).gaps.map((g) => g.key)).not.toContain("weights");
  });

  it("flags stale progress only while work is under way", () => {
    expect(dataQualityGaps(healthy({ lastProgressAt: d("2026-09-20") })).gaps.find((g) => g.key === "stale-progress")?.label).toMatch(/22 days/);
    expect(dataQualityGaps(healthy({ lastProgressAt: d("2026-09-20"), status: "FOR_PUNCHLIST" })).gaps.map((g) => g.key)).not.toContain("stale-progress");
    expect(dataQualityGaps(healthy({ lastProgressAt: d("2026-10-01") })).gaps.map((g) => g.key)).not.toContain("stale-progress");
  });

  it("flags progress with no cost, and billing problems", () => {
    expect(dataQualityGaps(healthy({ committed: 0 })).gaps.map((g) => g.key)).toContain("no-cost");
    expect(dataQualityGaps(healthy({ progressPct: 0, committed: 0 })).gaps.map((g) => g.key)).not.toContain("no-cost");
    const billing = dataQualityGaps(healthy({ billingTermCount: 0, billingCoverage: "none" })).gaps.map((g) => g.key);
    expect(billing).toContain("no-terms");
    expect(billing).not.toContain("coverage");
    expect(dataQualityGaps(healthy({ billingCoverage: "under" })).gaps.map((g) => g.key)).toContain("coverage");
    expect(dataQualityGaps(healthy({ billedWithoutDueDate: 2 })).gaps.find((g) => g.key === "due-dates")?.label).toMatch(/2 invoiced terms/);
  });

  it("only expects a closeout checklist at punch-list stage or later", () => {
    expect(dataQualityGaps(healthy()).gaps.map((g) => g.key)).not.toContain("closeout");
    expect(dataQualityGaps(healthy({ status: "FOR_PUNCHLIST" })).gaps.map((g) => g.key)).toContain("closeout");
    expect(dataQualityGaps(healthy({ status: "FOR_PUNCHLIST", closeoutTotal: 9 })).gaps.map((g) => g.key)).not.toContain("closeout");
  });

  it("runs fewer checks for a prospect, so a quiet pipeline project isn't called incomplete", () => {
    const prospect = dataQualityGaps(healthy({ status: "SITE_SURVEY", startDate: null, targetEndDate: null, milestoneCount: 0, progressEntryCount: 0, committed: 0, billingTermCount: 0, billingCoverage: "none", hasManager: false }));
    expect(prospect.gaps).toEqual([]);
    expect(prospect.checksRun).toBe(0);
  });
});

describe("milestone templates", () => {
  const start = d("2026-11-02");

  it("lays steps end to end with no gaps or overlaps", () => {
    for (const key of ["building", "civil"] as const) {
      const ms = buildTemplateMilestones(key, start);
      expect(ms).toHaveLength(MILESTONE_TEMPLATES[key].steps.length);
      expect(ms[0].forecastStart.toISOString().slice(0, 10)).toBe("2026-11-02");
      for (let i = 1; i < ms.length; i++) {
        const prevEnd = ms[i - 1].forecastFinish.getTime();
        expect(ms[i].forecastStart.getTime()).toBe(prevEnd + 86_400_000);
        expect(ms[i].forecastFinish.getTime()).toBeGreaterThanOrEqual(ms[i].forecastStart.getTime());
      }
    }
  });

  it("gives each step its planned number of days", () => {
    const ms = buildTemplateMilestones("civil", start);
    const days = ms.map((m) => (m.forecastFinish.getTime() - m.forecastStart.getTime()) / 86_400_000 + 1);
    expect(days).toEqual(MILESTONE_TEMPLATES.civil.steps.map((s) => s.days));
  });

  it("produces date-only values (UTC midnight), so there is no timezone drift", () => {
    for (const m of buildTemplateMilestones("building", start)) {
      expect(m.forecastStart.getUTCHours()).toBe(0);
      expect(m.forecastFinish.getUTCHours()).toBe(0);
    }
  });
});
