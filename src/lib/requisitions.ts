/**
 * Who may raise a material requisition: Foremen, PMs, the Owner, drivers and anyone in the Architect/Engineer departments by
 * their role, plus anyone the Owner has switched on individually (People page → "Can raise requisitions"). Never a client.
 * One rule, used by the New requisition button, the form page and the API, so they can't disagree.
 */
export function canRaiseRequisition(u: { role: string; department?: string | null; canRequisition?: boolean | null }): boolean {
  if (u.role === "CLIENT") return false;
  return ["FOREMAN", "PM", "OWNER", "DRIVER"].includes(u.role) || ["ARCHITECT", "ENGINEER"].includes(u.department ?? "") || !!u.canRequisition;
}

/**
 * Sees only the requisitions they raised themselves: Foremen always, and anyone the Owner switched "Sees only their own
 * requisitions" on for (People page). Everyone else with the Requisitions tab sees all of them. One rule for the list, a single
 * requisition, search and the API.
 */
export const seesOnlyOwnRequisitions = (u: { role: string; ownRequisitionsOnly?: boolean | null }): boolean => u.role === "FOREMAN" || !!u.ownRequisitionsOnly;

/** Whether the role/department already allows it, so the Owner's switch isn't needed. */
export const requisitionAllowedByRole = (u: { role: string; department?: string | null }) => canRaiseRequisition({ ...u, canRequisition: false });

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
