import { dayIndex, manilaToday } from "@/lib/milestones";

export type FindingTypeLike = "DEFECT" | "PUNCH_ITEM" | "INSPECTION" | "SAFETY_OBSERVATION" | "INCIDENT";
export type FindingSeverityLike = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type FindingStatusLike = "OPEN" | "IN_PROGRESS" | "READY_FOR_REVIEW" | "CLOSED";

export const formatFindingNumber = (n: number) => `QS-${String(n).padStart(3, "0")}`;

export const FINDING_TYPE_LABEL: Record<FindingTypeLike, string> = {
  DEFECT: "Defect",
  PUNCH_ITEM: "Punch item",
  INSPECTION: "Inspection finding",
  SAFETY_OBSERVATION: "Safety observation",
  INCIDENT: "Incident",
};

export const SEVERITY_ORDER: FindingSeverityLike[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

interface Viewer {
  id: string;
  role: string;
}

const isApprover = (role: string) => role === "OWNER" || role === "PM";

/** Incidents are sensitive: only Owner, PM, the person who reported it and the person assigned to it see them. */
export const isRestrictedType = (t: FindingTypeLike) => t === "INCIDENT";

export function canViewFinding(f: { restricted: boolean; raisedById: string; ownerId: string | null }, viewer: Viewer): boolean {
  if (!f.restricted) return true;
  return isApprover(viewer.role) || f.raisedById === viewer.id || f.ownerId === viewer.id;
}

/** Foremen can report anything; Owner and PM too. Nobody else raises findings. */
export const canRaiseFinding = (role: string) => isApprover(role) || role === "FOREMAN";

/** Start work or submit closure evidence: the assigned person, or Owner/PM. */
export function canWorkFinding(f: { ownerId: string | null }, viewer: Viewer): boolean {
  return isApprover(viewer.role) || (f.ownerId != null && f.ownerId === viewer.id);
}

/**
 * Closing needs evidence from the person who fixed it: a note always, and a photo
 * for HIGH and CRITICAL findings. Returns an error message or null.
 */
export function closureProblems(f: { severity: FindingSeverityLike }, input: { note: string; photoCount: number }): string | null {
  if (input.note.trim().length < 5) return "Describe what was done (at least 5 characters)";
  if ((f.severity === "HIGH" || f.severity === "CRITICAL") && input.photoCount < 1) {
    return "Add at least one photo showing the fix — it's required for high and critical findings";
  }
  return null;
}

/** A different person reviews the fix: the person who submitted the closure can't also close it (the Owner can). */
export function canCloseFinding(f: { status: FindingStatusLike; closureSubmittedById: string | null }, viewer: Viewer): boolean {
  if (f.status !== "READY_FOR_REVIEW" || !isApprover(viewer.role)) return false;
  if (viewer.role === "OWNER") return true;
  return f.closureSubmittedById !== viewer.id;
}

export const canSendBackFinding = (f: { status: FindingStatusLike }, viewer: Viewer) => f.status === "READY_FOR_REVIEW" && isApprover(viewer.role);

/** Reopening a closed finding is an Owner decision. */
export const canReopenFinding = (f: { status: FindingStatusLike }, viewer: Viewer) => f.status === "CLOSED" && viewer.role === "OWNER";

export type FindingDueState = "none" | "overdue" | "due-soon" | "ok";

export function findingDueState(f: { status: FindingStatusLike; dueDate: Date | null }, now: Date, soonDays = 3): FindingDueState {
  if (f.status === "CLOSED" || !f.dueDate) return "none";
  const today = manilaToday(now);
  const due = dayIndex(f.dueDate)!;
  if (due < today) return "overdue";
  return due - today <= soonDays ? "due-soon" : "ok";
}

export interface FindingCounts {
  open: number;
  openBySeverity: Record<FindingSeverityLike, number>;
  overdue: number;
  readyForReview: number;
  closedLast30Days: number;
}

/** Plain counts only. No rate is calculated because hours worked aren't recorded. */
export function findingCounts(
  findings: { status: FindingStatusLike; severity: FindingSeverityLike; dueDate: Date | null; closedAt: Date | null }[],
  now: Date
): FindingCounts {
  const c: FindingCounts = { open: 0, openBySeverity: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 }, overdue: 0, readyForReview: 0, closedLast30Days: 0 };
  for (const f of findings) {
    if (f.status === "CLOSED") {
      if (f.closedAt && now.getTime() - f.closedAt.getTime() <= 30 * 86_400_000) c.closedLast30Days++;
      continue;
    }
    c.open++;
    c.openBySeverity[f.severity]++;
    if (f.status === "READY_FOR_REVIEW") c.readyForReview++;
    if (findingDueState(f, now) === "overdue") c.overdue++;
  }
  return c;
}
