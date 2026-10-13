import { manilaToday, dayIndex } from "@/lib/milestones";

export interface QualityGap {
  key: string;
  severity: 1 | 2;
  label: string;
  fix: string;
  href: string;
}

export interface DataQualityInput {
  now: Date;
  status: string; // ProjectStatus
  startDate: Date | null;
  targetEndDate: Date | null;
  hasManager: boolean;
  milestoneCount: number;
  milestonesWithBaseline: number;
  progressEntryCount: number;
  weightsTotal: number | null; // null = no weighted work items yet
  lastProgressAt: Date | null;
  progressPct: number;
  committed: number;
  billingTermCount: number;
  billingCoverage: "complete" | "under" | "over" | "none";
  billedWithoutDueDate: number;
  closeoutTotal: number;
}

export interface DataQualityResult {
  gaps: QualityGap[];
  checksRun: number;
  passed: number;
}

const STALE_PROGRESS_DAYS = 14;

/**
 * Where a project's records are incomplete or stale. Only checks that make sense for the
 * project's stage are run (a prospect isn't expected to have progress; a finished job isn't
 * expected to have fresh progress), so "all good" means all *applicable* checks pass. This is
 * how missing data is made visible instead of being read as a healthy zero.
 */
export function dataQualityGaps(i: DataQualityInput): DataQualityResult {
  const gaps: QualityGap[] = [];
  let checks = 0;
  const check = (applies: boolean, failed: boolean, gap: QualityGap) => {
    if (!applies) return;
    checks++;
    if (failed) gaps.push(gap);
  };

  const inConstruction = i.status === "MOBILIZATION" || i.status === "ONGOING_CONSTRUCTION" || i.status === "ON_HOLD" || i.status === "FOR_PUNCHLIST";
  const active = inConstruction || i.status === "TURNED_OVER";
  const working = i.status === "MOBILIZATION" || i.status === "ONGOING_CONSTRUCTION";
  const today = manilaToday(i.now);

  check(inConstruction, !i.startDate, { key: "start", severity: 1, label: "No start date", fix: "Set the start date so schedule status can be judged", href: "#overview" });
  check(inConstruction, !i.targetEndDate, { key: "target", severity: 1, label: "No target finish date", fix: "Set a target finish date on the project", href: "#overview" });
  check(inConstruction, !i.hasManager, { key: "pm", severity: 1, label: "No project manager assigned", fix: "Assign a PM to the project so items have an owner", href: "#overview" });
  check(inConstruction, i.milestoneCount === 0, { key: "milestones", severity: 1, label: "No milestones", fix: "Add milestones (or start from a template) in the Schedule section", href: "#schedule" });
  check(inConstruction && i.milestoneCount > 0, i.milestonesWithBaseline === 0, { key: "baseline", severity: 1, label: "No milestone has an approved baseline", fix: "The Owner sets baseline dates so slippage can be measured", href: "#schedule" });
  check(inConstruction && i.progressEntryCount > 0, i.weightsTotal != null && Math.abs(i.weightsTotal - 100) > 0.01, {
    key: "weights",
    severity: i.weightsTotal != null && i.weightsTotal > 100 ? 2 : 1,
    label: `Work-item weights total ${i.weightsTotal?.toFixed(0)}%`,
    fix: i.weightsTotal != null && i.weightsTotal > 100 ? "Weights above 100% overstate progress — correct them" : "Part of the scope has no work item, so progress can't reach 100%",
    href: "#progress",
  });
  check(working, i.progressEntryCount === 0, { key: "no-progress", severity: 1, label: "No progress reported yet", fix: "Ask the foreman for a progress entry", href: "#progress" });
  const staleDays = i.lastProgressAt ? today - dayIndex(i.lastProgressAt)! : null;
  check(working && i.progressEntryCount > 0, staleDays != null && staleDays > STALE_PROGRESS_DAYS, { key: "stale-progress", severity: 1, label: `Progress last updated ${staleDays} days ago`, fix: "Ask the foreman for a fresh progress entry", href: "#progress" });
  check(inConstruction && i.progressPct > 0, i.committed <= 0, { key: "no-cost", severity: 1, label: "Progress reported but no cost recorded", fix: "Post approved costs so the forecast margin can be shown", href: "#commercial" });
  check(active, i.billingTermCount === 0, { key: "no-terms", severity: 1, label: "No billing terms set up", fix: "Set up the payment terms for this contract", href: "#commercial" });
  check(active && i.billingTermCount > 0, i.billingCoverage === "under" || i.billingCoverage === "over", {
    key: "coverage",
    severity: 1,
    label: i.billingCoverage === "over" ? "Billing terms add up to more than the contract" : "Billing terms don't cover the whole contract",
    fix: "Adjust the billing terms to match the contract value",
    href: "#commercial",
  });
  check(active, i.billedWithoutDueDate > 0, { key: "due-dates", severity: 1, label: `${i.billedWithoutDueDate} invoiced term${i.billedWithoutDueDate === 1 ? "" : "s"} with no due date`, fix: "Enter due dates under Billing details so lateness can be measured", href: "#commercial" });
  check(i.status === "FOR_PUNCHLIST" || i.status === "TURNED_OVER", i.closeoutTotal === 0, { key: "closeout", severity: 1, label: "No closeout checklist", fix: "Start the closeout checklist", href: "#closeout" });

  return { gaps, checksRun: checks, passed: checks - gaps.length };
}
