/**
 * Which tabs sit on the bottom bar of the phone view. Everyone starts with a sensible set for their role and can pick
 * their own (2 to 5) under My settings. Only tabs the person can actually open are ever shown.
 */
export const CASH_TAB = "/cash-expense";
export const MIN_TABS = 2;
export const MAX_TABS = 5;

/** Where a tab's link goes (Cash Expense opens on its first page). */
export const tabTarget = (href: string) => (href === CASH_TAB ? "/cash-expense/petty-cash" : href);

/** The default order of preference for each kind of person; the first five they can open are used. */
function preference(role: string): string[] {
  switch (role) {
    case "OWNER":
      return ["/dashboard", "/requisitions", "/purchasing", "/deliveries", CASH_TAB, "/attendance"];
    case "PM":
    case "FOREMAN":
      return ["/projects", "/requisitions", "/deliveries", "/attendance", CASH_TAB, "/instructions"];
    case "DRIVER":
      return ["/deliveries", "/requisitions", "/attendance", CASH_TAB, "/payroll", "/instructions"];
    case "OFFICE":
      return ["/attendance", "/instructions", "/payroll", CASH_TAB];
    default: // purchasing, accounting
      return ["/requisitions", "/purchasing", "/deliveries", "/attendance", CASH_TAB, "/instructions"];
  }
}

/** The bar a person gets until they choose their own. `available` is every tab they can open, in menu order. */
export function defaultTabs(role: string, available: string[]): string[] {
  const can = new Set(available);
  const picked = preference(role).filter((h) => can.has(h));
  for (const h of available) if (picked.length < MAX_TABS && !picked.includes(h)) picked.push(h);
  return picked.slice(0, MAX_TABS);
}

/** The person's own choice if it still makes sense (tabs they've lost access to are dropped), else the default. */
export function resolveTabs(stored: string[] | null | undefined, role: string, available: string[]): string[] {
  const can = new Set(available);
  const mine = Array.from(new Set(stored ?? [])).filter((h) => can.has(h)).slice(0, MAX_TABS);
  return mine.length >= MIN_TABS ? mine : defaultTabs(role, available);
}
