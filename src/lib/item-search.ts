/**
 * Finding an item in a long stock list by typing part of its name. Pure, so the picker and the tests share it.
 *
 * Every word typed must appear in the name, in any order ("pvc 2" finds "PVC Pipe 2" (Blue)"). Sizes written with quotes or
 * dashes still match ("1-1/2" finds "PVC Pipe 1 -1/2" (Blue)"), because a second, compact comparison ignores spaces, quotes
 * and dashes. Names that start with what was typed come first, then names with a word starting with it, then the rest.
 */
export interface PickItem {
  id: string;
  name: string;
  unit: string;
  category: string;
  /** how many there are (in the warehouse, or on the site for that project's list) */
  qty: number;
}

const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9/.]/g, "");
const words = (s: string) => s.toLowerCase().split(/[^a-z0-9/."-]+/).filter(Boolean);

export const MAX_SHOWN = 50;

/** null = does not match; otherwise lower is a better match. */
export function matchScore(name: string, query: string): number | null {
  const q = query.trim().toLowerCase();
  if (!q) return 3;
  const lower = name.toLowerCase();
  const nameCompact = compact(name);
  const tokens = q.split(/\s+/).filter(Boolean);
  const all = tokens.every((t) => lower.includes(t) || nameCompact.includes(compact(t)));
  if (!all) return null;
  if (lower.startsWith(q) || nameCompact.startsWith(compact(q))) return 0;
  const nameWords = words(name);
  if (tokens.every((t) => nameWords.some((w) => w.startsWith(t) || compact(w).startsWith(compact(t))))) return 1;
  return 2;
}

export function filterItems<T extends PickItem>(items: T[], opts: { query?: string; category?: string | null; limit?: number }): { matches: T[]; total: number } {
  const query = opts.query ?? "";
  const scored = items
    .filter((i) => !opts.category || i.category === opts.category)
    .flatMap((i) => {
      const score = matchScore(i.name, query);
      return score === null ? [] : [{ i, score }];
    })
    .sort((a, b) => a.score - b.score || a.i.name.localeCompare(b.i.name, undefined, { numeric: true }));
  return { matches: scored.slice(0, opts.limit ?? MAX_SHOWN).map((x) => x.i), total: scored.length };
}

/** The items a person used most recently, newest first, skipping any that no longer exist. */
export function recentItems<T extends { id: string }>(recentIds: string[], items: T[], limit = 6): T[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const out: T[] = [];
  for (const id of recentIds) {
    const item = byId.get(id);
    if (item && !out.includes(item)) out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}
