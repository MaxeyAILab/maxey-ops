/**
 * Weighted accomplishment rollup. Each ProgressEntry records a completion %
 * for one named work item (not the whole project). A work item's *current*
 * status is its most recent entry; the project's overall accomplishment is
 * the weighted average of every work item's current completion %, weighted
 * by that item's share of the project (the `weight` field, e.g. 30 = 30%
 * of scope).
 *
 * Review lifecycle: an entry is SUBMITTED by the field, then APPROVED (or
 * QUERIED back) by a PM/Owner. Only APPROVED entries count as verified
 * progress; submitted-but-unreviewed work is reported separately.
 */

export type ReviewStatus = "SUBMITTED" | "QUERIED" | "APPROVED";

export interface ProgressEntryLike {
  workItem: string | null;
  weight: unknown; // Prisma Decimal | number | null
  pctComplete: unknown; // Prisma Decimal | number
  color?: string | null;
  createdAt: Date;
  /** Required on purpose: every caller must say which entries it loaded, so a
   * forgotten field is a compile error rather than silently counting
   * unreviewed work as verified. */
  reviewStatus: ReviewStatus;
  reviewedAt?: Date | null;
}

export interface WorkItemStatus {
  workItem: string;
  weight: number;
  pctComplete: number;
  color: string;
  lastUpdated: Date;
}

// Deterministic fallback so items reported before the color picker existed
// (or never touched from its default) still render as distinct, stable colors.
const FALLBACK_PALETTE = [
  "#2563eb", // blue
  "#d97706", // orange
  "#059669", // green
  "#7c3aed", // violet
  "#db2777", // pink
  "#0891b2", // cyan
  "#a03426", // oxide
  "#65a30d", // lime
];
function fallbackColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return FALLBACK_PALETTE[hash % FALLBACK_PALETTE.length];
}

function collapse(entries: ProgressEntryLike[], allowed: ReadonlySet<ReviewStatus>): WorkItemStatus[] {
  const byItem = new Map<string, WorkItemStatus>();
  for (const e of entries) {
    if (!allowed.has(e.reviewStatus)) continue;
    const name = e.workItem?.trim();
    if (!name || e.weight == null) continue;
    const existing = byItem.get(name);
    if (!existing || e.createdAt > existing.lastUpdated) {
      byItem.set(name, {
        workItem: name,
        weight: Number(e.weight),
        pctComplete: Number(e.pctComplete),
        color: e.color || fallbackColor(name),
        lastUpdated: e.createdAt,
      });
    }
  }
  return Array.from(byItem.values()).sort((a, b) => b.weight - a.weight);
}

const APPROVED_ONLY: ReadonlySet<ReviewStatus> = new Set(["APPROVED"]);
const APPROVED_OR_SUBMITTED: ReadonlySet<ReviewStatus> = new Set(["APPROVED", "SUBMITTED"]);

/**
 * Collapses entries down to one row per distinct work item name — its most
 * recently reported weight + completion % + color. Only APPROVED entries
 * count: this is the verified view that owners, finance forecasts and the
 * client portal all rely on. Entries with no work item name or no weight are
 * excluded (nothing to attribute them to in the rollup).
 */
export function computeWorkItemStatuses(entries: ProgressEntryLike[]): WorkItemStatus[] {
  return collapse(entries, APPROVED_ONLY);
}

/**
 * Overall project accomplishment, 0–100 — each work item's weight is its
 * share of the *whole project* (Spec: "30 = 30% of scope"), so this divides
 * by a fixed 100, not by the sum of logged items' weights. Work items with
 * no entry yet correctly contribute 0, the same as the "Remaining" grey
 * segment on AccomplishmentRadial — the two must always agree, since this is
 * shown side-by-side with that chart on the project page.
 */
export function weightedAccomplishment(statuses: WorkItemStatus[]): number {
  const weighted = statuses.reduce((s, x) => s + x.weight * x.pctComplete, 0);
  return Math.max(0, Math.min(100, weighted / 100));
}

/** This item's contribution to the overall weighted accomplishment, 0–100. */
export function weightedContribution(status: WorkItemStatus): number {
  return (status.weight * status.pctComplete) / 100;
}

export interface ProgressSummary {
  /** Weighted accomplishment from approved entries only, 0–100. */
  verifiedPct: number;
  /** The same figure if every submitted-but-unreviewed entry were approved. */
  submittedPct: number;
  pendingCount: number;
  queriedCount: number;
  /** Latest approval time across approved entries (falls back to entry time). */
  lastVerifiedAt: Date | null;
}

export function summarizeProgress(entries: ProgressEntryLike[]): ProgressSummary {
  const verifiedPct = weightedAccomplishment(collapse(entries, APPROVED_ONLY));
  const submittedPct = weightedAccomplishment(collapse(entries, APPROVED_OR_SUBMITTED));
  let lastVerifiedAt: Date | null = null;
  for (const e of entries) {
    if (e.reviewStatus !== "APPROVED") continue;
    const at = e.reviewedAt ?? e.createdAt;
    if (!lastVerifiedAt || at > lastVerifiedAt) lastVerifiedAt = at;
  }
  return {
    verifiedPct,
    submittedPct,
    pendingCount: entries.filter((e) => e.reviewStatus === "SUBMITTED").length,
    queriedCount: entries.filter((e) => e.reviewStatus === "QUERIED").length,
    lastVerifiedAt,
  };
}

/**
 * Sum of each work item's current weight, using the latest entry of any
 * status (a proposed weight counts, so pending work can't push the total past
 * 100). `candidate` overlays a new or edited entry; `excludeId` drops the
 * entry being edited so it isn't counted twice.
 */
export function weightTotal(
  entries: { id?: string; workItem: string | null; weight: unknown; createdAt: Date }[],
  candidate?: { workItem: string | null; weight: number | null; excludeId?: string }
): number {
  const latest = new Map<string, { weight: number; at: number }>();
  for (const e of entries) {
    if (candidate?.excludeId && e.id === candidate.excludeId) continue;
    const name = e.workItem?.trim();
    if (!name || e.weight == null) continue;
    const at = e.createdAt.getTime();
    const cur = latest.get(name);
    if (!cur || at > cur.at) latest.set(name, { weight: Number(e.weight), at });
  }
  if (candidate?.workItem?.trim() && candidate.weight != null) {
    latest.set(candidate.workItem.trim(), { weight: candidate.weight, at: Number.MAX_SAFE_INTEGER });
  }
  return Array.from(latest.values()).reduce((sum, x) => sum + x.weight, 0);
}

/** The weight an item was last approved at, or null if it has no approved entry yet. */
export function approvedWeight(
  entries: { workItem: string | null; weight: unknown; createdAt: Date; reviewStatus: ReviewStatus }[],
  workItem: string
): number | null {
  let best: { weight: number; at: number } | null = null;
  for (const e of entries) {
    if (e.reviewStatus !== "APPROVED" || e.workItem?.trim() !== workItem.trim() || e.weight == null) continue;
    const at = e.createdAt.getTime();
    if (!best || at > best.at) best = { weight: Number(e.weight), at };
  }
  return best ? best.weight : null;
}

/**
 * Server-side weight rules for a new or edited progress entry. Returns a
 * human-readable error, or null if allowed:
 *  - a work item's weight is locked once it has an approved entry; only a
 *    PM/Owner may change it (so a field entry can't silently re-weight scope);
 *  - the project's weights may not be pushed past 100% (existing bad data is
 *    tolerated — an entry that doesn't increase the total is never blocked).
 */
export function checkWeightRules(
  entries: { id?: string; workItem: string | null; weight: unknown; createdAt: Date; reviewStatus: ReviewStatus }[],
  candidate: { workItem: string | null; weight: number | null; excludeId?: string },
  isApprover: boolean
): string | null {
  const name = candidate.workItem?.trim();
  if (!name || candidate.weight == null) return null;
  const others = candidate.excludeId ? entries.filter((e) => e.id !== candidate.excludeId) : entries;
  const locked = approvedWeight(others, name);
  if (locked != null && Math.abs(locked - candidate.weight) > 0.001 && !isApprover) {
    return `The weight for "${name}" is locked at ${locked}% — ask the PM or Owner to change it.`;
  }
  const before = weightTotal(entries, { workItem: null, weight: null, excludeId: candidate.excludeId });
  const after = weightTotal(entries, candidate);
  if (after > 100.01 && after > before + 0.001) {
    return `Work-item weights would total ${after.toFixed(0)}% — they can't exceed 100%.`;
  }
  return null;
}
