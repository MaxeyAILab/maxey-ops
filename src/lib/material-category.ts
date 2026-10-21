/**
 * The four groups warehouse materials are sorted into. The Inventory tab shows only these groups; the items of each group are
 * on the stock page (/inventory/stock).
 */
export const MATERIAL_CATEGORIES = [
  { value: "CIVIL_ARCHITECTURAL", label: "Civil & Architectural", slug: "civil-architectural", icon: "🧱", hint: "cement, steel, sand & gravel, lumber, paint, tiles…" },
  { value: "PLUMBING", label: "Plumbing", slug: "plumbing", icon: "🚰", hint: "pipes, fittings, valves, fixtures…" },
  { value: "ELECTRICAL", label: "Electrical", slug: "electrical", icon: "💡", hint: "wires, conduits, breakers, lights…" },
  { value: "OTHERS", label: "Others (Mechanical etc.)", slug: "others", icon: "⚙️", hint: "mechanical, safety, consumables, everything else" },
] as const;

export type MaterialCategoryValue = (typeof MATERIAL_CATEGORIES)[number]["value"];

export const MATERIAL_CATEGORY_LABEL: Record<MaterialCategoryValue, string> = Object.fromEntries(MATERIAL_CATEGORIES.map((c) => [c.value, c.label])) as Record<MaterialCategoryValue, string>;

export const isMaterialCategory = (v: unknown): v is MaterialCategoryValue => MATERIAL_CATEGORIES.some((c) => c.value === v);

/** "plumbing" (as used in the page address) → PLUMBING, or null when it isn't one of the four. */
export function categoryFromSlug(slug: string | null | undefined): MaterialCategoryValue | null {
  return MATERIAL_CATEGORIES.find((c) => c.slug === slug)?.value ?? null;
}

export const categorySlug = (value: MaterialCategoryValue): string => MATERIAL_CATEGORIES.find((c) => c.value === value)!.slug;

/** Items counted per category, with how many of them are out of stock — for the four tiles on the Inventory tab. */
export function summarizeByCategory(items: { category: string; currentQty: unknown }[]): Record<MaterialCategoryValue, { items: number; outOfStock: number }> {
  const out = Object.fromEntries(MATERIAL_CATEGORIES.map((c) => [c.value, { items: 0, outOfStock: 0 }])) as Record<MaterialCategoryValue, { items: number; outOfStock: number }>;
  for (const i of items) {
    const key = isMaterialCategory(i.category) ? i.category : "OTHERS";
    out[key].items += 1;
    if (Number(i.currentQty) <= 0) out[key].outOfStock += 1;
  }
  return out;
}
