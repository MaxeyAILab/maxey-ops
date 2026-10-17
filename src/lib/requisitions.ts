/** The "General & Administrative" section of the requisition dropdown: company purchases that aren't tied to a
 * project (office needs, warehouse stock, emergencies). Stored as the categories OFFICE_SUPPLY / WAREHOUSE_SUPPLY /
 * EMERGENCY — only the wording changed. */
export const GA_LABEL = "General & Administrative";

export const NON_PROJECT_CATEGORIES = [
  { value: "OFFICE_SUPPLY", label: "Office" },
  { value: "WAREHOUSE_SUPPLY", label: "Warehouse" },
  { value: "EMERGENCY", label: "Emergency" },
] as const;

export type NonProjectCategory = (typeof NON_PROJECT_CATEGORIES)[number]["value"];

export const CATEGORY_LABELS: Record<string, string> = {
  OFFICE_SUPPLY: "Office",
  WAREHOUSE_SUPPLY: "Warehouse",
  EMERGENCY: "Emergency",
};

/** What to show wherever a requisition/PO/delivery's "project" is displayed. */
export function projectOrCategoryLabel(r: {
  project?: { name: string } | null;
  category?: string | null;
}): string {
  if (r.project) return r.project.name;
  return `G&A · ${CATEGORY_LABELS[r.category ?? "EMERGENCY"] ?? "General"}`;
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
