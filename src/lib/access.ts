import type { Department, Role } from "@prisma/client";
import { isOfficeStaff } from "@/lib/cash-expense";

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
 * Cash Expense (2026-10-19) is open to every staff account — see
 * canUseCashExpense — so it isn't part of this matrix's checklist.
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

/**
 * Cash Expense tab: every staff account has it (2026-10-19, Owner's rule) — what each person sees inside depends on
 * them (see seesAllPettyCash in cash-expense.ts): office staff see everyone's records, site workers and drivers only
 * their own. Independent of the per-account tab checklist.
 */
export function canUseCashExpense(u: { role: Role }): boolean {
  return u.role !== "CLIENT";
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
 * role, plus Drivers and Engineers (2026-09-21). "Driver" counts both as the
 * account type and as the department: some drivers have an Office account in the
 * Driver department (payroll treats them as drivers), and they must be able to
 * verify too. Deliberately separate from delete, which stays Owner-only. */
export function canVerifyDelivery(role: Role, department: Department | null): boolean {
  return ["FOREMAN", "PM", "OWNER", "DRIVER"].includes(role) || department === "ENGINEER" || department === "DRIVER";
}

/** Site roles that are a job title rather than an account type: a timekeeper, a leadman (any spelling: Lead Man, Lead-man…). */
const SITE_LOGGER_POSITION = /time[\s-]*keeper|lead[\s-]*(man|men)\b/i;
export const isTimekeeperOrLeadman = (position: string | null | undefined): boolean => !!position && SITE_LOGGER_POSITION.test(position);

interface InventoryPerson {
  role: Role;
  department: Department | null;
  position?: string | null;
  customMenus?: string[];
  useCustomMenus?: boolean;
}

const hasInventoryTab = (u: InventoryPerson) => canAccess(u.role, u.department, "/inventory", u.customMenus ?? [], u.useCustomMenus ?? false);

/**
 * Who can add a warehouse stock item or a tool/equipment unit (Inventory tab): the Owner, PM and Purchasing by role, plus office
 * staff (Office, Architect and Engineer departments — the same "office staff" as Cash Expense) who have the Inventory tab
 * (2026-10-21).
 */
export function canAddInventoryCatalog(u: InventoryPerson): boolean {
  if (["OWNER", "PM", "PURCHASING"].includes(u.role)) return true;
  return hasInventoryTab(u) && isOfficeStaff(u);
}

/**
 * Who can log a stock movement or check a tool out/in: Foreman, PM, Owner and Purchasing by role, plus — when they have the
 * Inventory tab — office staff, drivers (the Driver account type or department) and timekeepers and leadmen (by position)
 * (2026-10-21; drivers were left out until then).
 */
export function canLogInventoryMovement(u: InventoryPerson): boolean {
  if (["FOREMAN", "PM", "OWNER", "PURCHASING"].includes(u.role)) return true;
  if (!hasInventoryTab(u)) return false;
  return u.role === "DRIVER" || u.department === "DRIVER" || isOfficeStaff(u) || isTimekeeperOrLeadman(u.position);
}

/**
 * Who can approve (or reject) a return or transfer request on the Inventory tab: the Owner, PM and Purchasing, and office staff
 * who have the Inventory tab (2026-10-21). Nobody but the Owner approves their own request.
 */
export function canApproveInventoryRequest(u: InventoryPerson): boolean {
  if (["OWNER", "PM", "PURCHASING"].includes(u.role)) return true;
  return hasInventoryTab(u) && isOfficeStaff(u);
}

/**
 * Who can delete a tool or piece of equipment: the Owner always (with its movement history); whoever may add tools (office
 * staff, PM, Purchasing) only a tool that has never been moved — i.e. one registered by mistake (2026-10-21).
 */
export function canDeleteTool(u: InventoryPerson, movementCount: number): boolean {
  if (u.role === "OWNER") return true;
  return canAddInventoryCatalog(u) && movementCount === 0;
}
