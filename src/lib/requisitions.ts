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

/** Real committed cost if a PO exists, else the estimate. Single source of
 * truth — used by the requisition folders view and the dashboard's
 * non-project expense rollup so the two never disagree. */
export function requisitionAmount(r: {
  estimatedCost: unknown;
  purchaseOrder: { totalCost: unknown } | null;
}): number {
  if (r.purchaseOrder) return Number(r.purchaseOrder.totalCost);
  return Number(r.estimatedCost ?? 0);
}
