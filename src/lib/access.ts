import type { Department, Role } from "@prisma/client";

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
 */
export function allowedMenus(role: Role, _department: Department | null): string[] {
  switch (role) {
    case "OWNER":
      return [
        "/dashboard",
        "/leads",
        "/projects",
        "/requisitions",
        "/purchasing",
        "/deliveries",
        "/inventory",
        "/instructions",
        "/attendance",
        "/payroll",
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
      ];
    case "DRIVER":
      return ["/requisitions", "/purchasing", "/deliveries", "/attendance", "/payroll"];
    case "PM":
      return [
        "/projects",
        "/requisitions",
        "/deliveries",
        "/inventory",
        "/instructions",
        "/attendance",
        "/payroll",
      ];
    case "ACCOUNTING":
    case "PURCHASING":
      return [
        "/projects",
        "/requisitions",
        "/purchasing",
        "/deliveries",
        "/inventory",
        "/attendance",
        "/payroll",
      ];
    case "OFFICE": // site workers and office staff
      return ["/attendance", "/payroll"];
    default:
      return [];
  }
}

export function canAccess(
  role: Role,
  department: Department | null,
  menu: string
): boolean {
  return allowedMenus(role, department).includes(menu);
}
