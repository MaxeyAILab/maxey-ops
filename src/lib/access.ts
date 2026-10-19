import type { Department, Role } from "@prisma/client";

/**
 * Tabs an Owner can grant to a staff account via the sign-in checklist
 * (Attendance → Add/Edit personnel). Owner-only tabs (Dashboard, Finance,
 * Leads, People) are never offered here — those stay tied to the OWNER role.
 */
export const ASSIGNABLE_MENUS: { href: string; label: string }[] = [
  { href: "/projects", label: "Projects" },
  { href: "/requisitions", label: "Requisitions" },
  { href: "/purchasing", label: "Purchasing" },
  { href: "/deliveries", label: "Deliveries" },
  { href: "/inventory", label: "Inventory" },
  { href: "/instructions", label: "Instructions" },
  { href: "/attendance", label: "Attendance" },
  { href: "/payroll", label: "Payroll" },
  { href: "/cash-expense", label: "Cash Expense (petty cash)" },
];

/**
 * Menu access matrix (owner's rules, 2026-07-06):
 * - Owner only: Dashboard, Leads, People (and all account creation)
 * - Foreman: Projects, Requisitions, Purchasing, Deliveries, Inventory,
 *   Attendance, Payroll (+ Instructions, which foremen must acknowledge per
 *   Spec 6.6)
 * - Site workers (generic staff on SITE): Attendance + Payroll only
 * - Drivers: Requisitions, Purchasing, Deliveries, Attendance, Payroll
 * Office staff mirror site workers (Spec §3: "time in/out, limited modules").
 * PM/Purchasing/Accounting keep their working menus minus Owner-only ones.
 * Instructions now doubles as the employee assignment tracker (2026-08-14)
 * — every non-Client role gets it so an assignee can reach their own task.
 * Cash Expense (2026-10-19): Owner and Accounting run the petty cash fund and
 * cash advances; PM, Foreman, Purchasing and Drivers get it to request petty
 * cash and liquidate their own.
 *
 * A per-account checklist can override this default (2026-09-15): when a
 * user has useCustomMenus set, their customMenus list is authoritative
 * instead of the role default below, so the Owner can grant (or withhold)
 * exactly the tabs a specific hire needs regardless of their role bundle.
 */
function roleDefaultMenus(role: Role): string[] {
  switch (role) {
    case "OWNER":
      return [
        "/dashboard",
        "/finance",
        "/leads",
        "/projects",
        "/requisitions",
        "/purchasing",
        "/deliveries",
        "/inventory",
        "/instructions",
        "/attendance",
        "/payroll",
        "/cash-expense",
        "/people",
      ];
    case "FOREMAN":
      return [
        "/projects",
        "/requisitions",
        "/purchasing",
        "/deliveries",
        "/inventory",
        "/instructions",
        "/attendance",
        "/payroll",
        "/cash-expense",
      ];
    case "DRIVER":
      return ["/requisitions", "/purchasing", "/deliveries", "/instructions", "/attendance", "/payroll", "/cash-expense"];
    case "PM":
      return [
        "/projects",
        "/requisitions",
        "/deliveries",
        "/inventory",
        "/instructions",
        "/attendance",
        "/payroll",
        "/cash-expense",
      ];
    case "ACCOUNTING":
    case "PURCHASING":
      return [
        "/projects",
        "/requisitions",
        "/purchasing",
        "/deliveries",
        "/inventory",
        "/instructions",
        "/attendance",
        "/payroll",
        "/cash-expense",
      ];
    case "OFFICE": // site workers and office staff
      return ["/instructions", "/attendance", "/payroll"];
    default:
      return [];
  }
}

const OWNER_ONLY_MENUS = new Set(["/dashboard", "/finance", "/leads", "/people"]);

export function allowedMenus(
  role: Role,
  department: Department | null,
  customMenus: string[] = [],
  useCustomMenus = false
): string[] {
  if (useCustomMenus) {
    // Even an explicit checklist can never reach Owner-only tabs — those
    // stay tied to the OWNER role, not to any per-account override.
    return customMenus.filter((m) => !OWNER_ONLY_MENUS.has(m));
  }
  const base = roleDefaultMenus(role);
  const extra: string[] = [];
  // Architects/engineers can submit requisitions regardless of their role
  // bundle (2026-09-21) — they're commonly hired under OFFICE, which
  // otherwise wouldn't reach this tab at all.
  if (department === "ARCHITECT" || department === "ENGINEER") extra.push("/requisitions");
  // Engineers can also verify deliveries (2026-09-21) — see canVerifyDelivery.
  if (department === "ENGINEER") extra.push("/deliveries");
  return extra.length ? Array.from(new Set([...base, ...extra])) : base;
}

/** Cash Expense tab: by role / tab checklist, or because the Owner made this person a petty cash approver or releaser. */
export function canUseCashExpense(u: {
  role: Role;
  department: Department | null;
  customMenus?: string[];
  useCustomMenus?: boolean;
  canApprovePettyCash?: boolean;
  canReleasePettyCash?: boolean;
}): boolean {
  if (u.role === "CLIENT") return false;
  return !!u.canApprovePettyCash || !!u.canReleasePettyCash || allowedMenus(u.role, u.department, u.customMenus, u.useCustomMenus).includes("/cash-expense");
}

export function canAccess(
  role: Role,
  department: Department | null,
  menu: string,
  customMenus: string[] = [],
  useCustomMenus = false
): boolean {
  return allowedMenus(role, department, customMenus, useCustomMenus).includes(menu);
}

/** Who can submit a delivery verification (Spec 6.3) — Foreman/PM/Owner by
 * role, plus Drivers and Engineers (2026-09-21). Deliberately separate from
 * delete, which stays Owner-only regardless of this. */
export function canVerifyDelivery(role: Role, department: Department | null): boolean {
  return ["FOREMAN", "PM", "OWNER", "DRIVER"].includes(role) || department === "ENGINEER";
}
