/**
 * Weighted accomplishment rollup. Each ProgressEntry records a completion %
 * for one named work item (not the whole project). A work item's *current*
 * status is its most recent entry; the project's overall accomplishment is
 * the weighted average of every work item's current completion %, weighted
 * by that item's share of the project (the `weight` field, e.g. 30 = 30%
 * of scope).
 */

export interface ProgressEntryLike {
  workItem: string | null;
  weight: unknown; // Prisma Decimal | number | null
  pctComplete: unknown; // Prisma Decimal | number
  color?: string | null;
  createdAt: Date;
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
  "#8a1a28", // brand burgundy
  "#65a30d", // lime
];
function fallbackColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return FALLBACK_PALETTE[hash % FALLBACK_PALETTE.length];
}

/**
 * Collapses entries down to one row per distinct work item name — its most
 * recently reported weight + completion % + color. Entries with no work item
 * name or no weight are excluded (nothing to attribute them to in the
 * rollup); older entries logged before this feature existed simply won't
 * have a weight.
 */
export function computeWorkItemStatuses(entries: ProgressEntryLike[]): WorkItemStatus[] {
  const byItem = new Map<string, WorkItemStatus>();
  for (const e of entries) {
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
