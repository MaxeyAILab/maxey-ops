/**
 * Which kinds of notification belong to which tab, so a tab on the phone's bottom bar can show how many new things happened
 * in it — the same kind of number the bell shows. (Security alerts have no tab; they only count on the bell.)
 */
export const TAB_CATEGORIES: Record<string, string[]> = {
  "/requisitions": ["REQUISITIONS"],
  "/purchasing": ["PURCHASING"],
  "/deliveries": ["DELIVERIES"],
  "/inventory": ["INVENTORY"],
  "/projects": ["PROJECTS"],
  "/instructions": ["INSTRUCTIONS"],
  "/attendance": ["ATTENDANCE"],
  "/payroll": ["PAYROLL"],
  "/cash-expense": ["CASH"],
  "/finance": ["FINANCE"],
  "/leads": ["LEADS"],
};

export type UnreadByCategory = Record<string, number>;

/** New things in one tab. */
export function tabUnread(href: string, byCategory: UnreadByCategory): number {
  return (TAB_CATEGORIES[href] ?? []).reduce((sum, c) => sum + (byCategory[c] ?? 0), 0);
}

/** New things in tabs that are NOT on the bottom bar (so the menu button can still flag them). */
export function unreadElsewhere(barHrefs: string[], byCategory: UnreadByCategory): number {
  const onBar = new Set(barHrefs.flatMap((h) => TAB_CATEGORIES[h] ?? []));
  const tabbed = new Set(Object.values(TAB_CATEGORIES).flat());
  return Object.entries(byCategory).reduce((sum, [c, n]) => (tabbed.has(c) && !onBar.has(c) ? sum + n : sum), 0);
}

/** The notification kinds to mark as read when a person opens a tab. */
export const categoriesForTab = (href: string): string[] => TAB_CATEGORIES[href] ?? [];

/** The number shown on a badge: capped so it never outgrows its circle. */
export const badgeText = (n: number): string => (n > 99 ? "99+" : String(n));
