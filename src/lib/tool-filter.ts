/**
 * Narrowing the tools & equipment list: by where a tool is and whether it needs attention, and by typing part of its name, tag,
 * category or where it is. Pure, shared by the page and the tests.
 */
export const TOOL_FILTERS = [
  { key: "all", label: "All" },
  { key: "warehouse", label: "In warehouse" },
  { key: "site", label: "On site" },
  { key: "attention", label: "Needs attention" },
] as const;
export type ToolFilterKey = (typeof TOOL_FILTERS)[number]["key"];

export const isToolFilter = (v: unknown): v is ToolFilterKey => TOOL_FILTERS.some((f) => f.key === v);

export interface ToolRow {
  name: string;
  assetTag: string | null;
  category: string | null;
  /** where it is: IN_WAREHOUSE, ON_SITE, UNDER_REPAIR, LOST */
  status: string;
  /** how it is doing: WORKING, FOR_REPAIR, NOT_WORKING, FOR_DISPOSAL */
  workingStatus: string;
  /** the project it is at, or "Warehouse" */
  location: string;
}

/** Not working, flagged for repair or disposal, under repair, or lost. */
export const needsAttention = (t: ToolRow) => t.workingStatus !== "WORKING" || t.status === "UNDER_REPAIR" || t.status === "LOST";

export function toolMatchesFilter(t: ToolRow, filter: ToolFilterKey): boolean {
  switch (filter) {
    case "warehouse":
      return t.status === "IN_WAREHOUSE";
    case "site":
      return t.status === "ON_SITE";
    case "attention":
      return needsAttention(t);
    default:
      return true;
  }
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Every word typed must be found somewhere in the name, tag, category or location. */
export function toolMatchesQuery(t: ToolRow, query: string): boolean {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const hay = [t.name, t.assetTag ?? "", t.category ?? "", t.location];
  return tokens.every((tok) => hay.some((h) => h.toLowerCase().includes(tok) || norm(h).includes(norm(tok))));
}

export function filterTools<T extends ToolRow>(tools: T[], filter: ToolFilterKey, query: string): T[] {
  return tools.filter((t) => toolMatchesFilter(t, filter) && toolMatchesQuery(t, query));
}

/** How many tools each filter button would show (before any search). */
export function toolFilterCounts(tools: ToolRow[]): Record<ToolFilterKey, number> {
  return Object.fromEntries(TOOL_FILTERS.map((f) => [f.key, tools.filter((t) => toolMatchesFilter(t, f.key)).length])) as Record<ToolFilterKey, number>;
}
