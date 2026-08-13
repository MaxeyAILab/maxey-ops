/** Non-project requisition categories — for emergencies and general company
 * purchases (broken tools, office supplies, warehouse stock) that shouldn't
 * be blocked on a project existing or being selected. */
export const NON_PROJECT_CATEGORIES = [
  { value: "EMERGENCY", label: "Emergency (no project)" },
  { value: "OFFICE_SUPPLY", label: "Office Supply (no project)" },
  { value: "WAREHOUSE_SUPPLY", label: "Warehouse Supply (no project)" },
] as const;

export type NonProjectCategory = (typeof NON_PROJECT_CATEGORIES)[number]["value"];

export const CATEGORY_LABELS: Record<string, string> = {
  EMERGENCY: "Emergency",
  OFFICE_SUPPLY: "Office Supply",
  WAREHOUSE_SUPPLY: "Warehouse Supply",
};

/** What to show wherever a requisition/PO/delivery's "project" is displayed. */
export function projectOrCategoryLabel(r: {
  project?: { name: string } | null;
  category?: string | null;
}): string {
  if (r.project) return r.project.name;
  return CATEGORY_LABELS[r.category ?? "EMERGENCY"] ?? "No project";
}

/** Real committed cost if a live (non-cancelled) PO exists, else the
 * estimate — a cancelled PO (kept around only because delivery history is
 * attached to it) contributes nothing further. Single source of truth —
 * used by the requisition folders view, getProjectFinances(), and the
 * dashboard's non-project expense rollup so none of them disagree. */
export function requisitionAmount(r: {
  estimatedCost: unknown;
  purchaseOrder: { totalCost: unknown; status?: string } | null;
}): number {
  if (r.purchaseOrder) {
    if (r.purchaseOrder.status === "CANCELLED") return 0;
    return Number(r.purchaseOrder.totalCost);
  }
  return Number(r.estimatedCost ?? 0);
}
