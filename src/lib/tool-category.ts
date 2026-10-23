/**
 * The four groups tools and equipment are sorted into — like the four material categories. The Inventory tab shows only these
 * groups; the tools of each group are on the tools page (/inventory/tools). The category is stored as text on the tool (older
 * entries said "Power Tool", "Hand Tool"…), so it is matched loosely and anything that fits none of the four counts as
 * "Not categorized" until someone chooses one.
 */
export const TOOL_CATEGORIES = [
  { value: "HAND", label: "Hand Tools", slug: "hand-tools", icon: "🔨", hint: "hammers, saws, wrenches, trowels…" },
  { value: "POWER", label: "Power Tools", slug: "power-tools", icon: "🔌", hint: "drills, grinders, cut-off machines, mixers…" },
  { value: "HEAVY", label: "Heavy Equipment", slug: "heavy-equipment", icon: "🚜", hint: "compactors, excavators, loaders, generators…" },
  { value: "SAFETY", label: "Safety Equipment", slug: "safety-equipment", icon: "🦺", hint: "helmets, harnesses, boots, barriers…" },
] as const;

export type ToolCategoryValue = (typeof TOOL_CATEGORIES)[number]["value"];
/** A tool whose category is empty or fits none of the four. */
export const NO_TOOL_CATEGORY = "NONE" as const;
export type ToolCategoryKey = ToolCategoryValue | typeof NO_TOOL_CATEGORY;
const NONE = NO_TOOL_CATEGORY;

export const TOOL_CATEGORY_LABEL: Record<ToolCategoryKey, string> = {
  ...(Object.fromEntries(TOOL_CATEGORIES.map((c) => [c.value, c.label])) as Record<ToolCategoryValue, string>),
  NONE: "Not categorized",
};

/** Which group a stored category text belongs to: "Power Tool", "power tools", "POWER TOOLS" → POWER; unknown or empty → NONE. */
export function toolCategoryKey(text: string | null | undefined): ToolCategoryKey {
  const t = (text ?? "").toLowerCase();
  if (/safety/.test(t)) return "SAFETY";
  if (/heavy/.test(t)) return "HEAVY";
  if (/power/.test(t)) return "POWER";
  if (/hand/.test(t)) return "HAND";
  return NONE;
}
/** The text to store for a category: its proper name ("Power Tools"), or null when it is empty. Returns undefined for text that is not one of the four. */
export function normalizeToolCategory(text: string | null | undefined): string | null | undefined {
  const trimmed = (text ?? "").trim();
  if (trimmed === "") return null;
  const key = toolCategoryKey(trimmed);
  return key === NONE ? undefined : TOOL_CATEGORY_LABEL[key];
}

/** "power-tools" (as used in the page address) → POWER, or NONE for "not-categorized"; null when it is not a group. */
export function toolCategoryFromSlug(slug: string | null | undefined): ToolCategoryKey | null {
  if (slug === "not-categorized") return NONE;
  return TOOL_CATEGORIES.find((c) => c.slug === slug)?.value ?? null;
}

export const toolCategorySlug = (key: ToolCategoryKey): string => (key === NONE ? "not-categorized" : TOOL_CATEGORIES.find((c) => c.value === key)!.slug);

export interface ToolCategorySummary {
  tools: number;
  inWarehouse: number;
  onSite: number;
  /** not working, for repair or disposal, under repair, or lost */
  attention: number;
}

/** How many tools are in each group, and how many are in the warehouse, out on a site, or need attention — for the tiles. */
export function summarizeToolCategories(rows: { category: string | null; status: string; workingStatus: string }[]): Record<ToolCategoryKey, ToolCategorySummary> {
  const out = Object.fromEntries([...TOOL_CATEGORIES.map((c) => c.value), NONE].map((k) => [k, { tools: 0, inWarehouse: 0, onSite: 0, attention: 0 }])) as Record<ToolCategoryKey, ToolCategorySummary>;
  for (const r of rows) {
    const s = out[toolCategoryKey(r.category)];
    s.tools += 1;
    if (r.status === "IN_WAREHOUSE") s.inWarehouse += 1;
    if (r.status === "ON_SITE") s.onSite += 1;
    if (r.workingStatus !== "WORKING" || r.status === "UNDER_REPAIR" || r.status === "LOST") s.attention += 1;
  }
  return out;
}
