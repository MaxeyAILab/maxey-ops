/** Non-project instruction categories — for office/site/delivery/warehouse
 * assignments that shouldn't be blocked on an active project existing. */
export const NON_PROJECT_INSTRUCTION_CATEGORIES = [
  { value: "OFFICE", label: "Office" },
  { value: "SITE", label: "Site (general)" },
  { value: "DELIVERIES", label: "Deliveries" },
  { value: "WAREHOUSE", label: "Warehouse" },
  { value: "OTHER", label: "Other" },
] as const;

export type NonProjectInstructionCategory = (typeof NON_PROJECT_INSTRUCTION_CATEGORIES)[number]["value"];

export const INSTRUCTION_CATEGORY_LABELS: Record<string, string> = {
  OFFICE: "Office",
  SITE: "Site (general)",
  DELIVERIES: "Deliveries",
  WAREHOUSE: "Warehouse",
  OTHER: "Other",
};

/** What to show wherever an instruction's "project" is displayed. */
export function instructionProjectOrCategoryLabel(i: {
  project?: { name: string } | null;
  category?: string | null;
}): string {
  if (i.project) return i.project.name;
  return INSTRUCTION_CATEGORY_LABELS[i.category ?? "OTHER"] ?? "No project";
}

/** Task ID prefix: a real project's own code when it has one, DOT (Driver's
 * Operation Task) for deliveries, otherwise OOT (Office Operations Task) —
 * the catch-all for office/general-site/warehouse/other non-project work. */
export function taskIdPrefix(projectCode: string | null | undefined, category: string | null | undefined): string {
  if (projectCode) return projectCode;
  if (category === "DELIVERIES") return "DOT";
  return "OOT";
}
