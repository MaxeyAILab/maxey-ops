import { describe, expect, it } from "vitest";
import { allowedMenus, canAddInventoryCatalog, canLogInventoryMovement, canUseTallyOuts } from "./access";
import { JOB_ROLES, JOB_ROLE_KEYS, isJobRole, jobRoleLabel, jobRoleTabs, resolveAccess } from "./role-presets";
import { canOpenTimesheets } from "./timesheet";

describe("the site and warehouse jobs", () => {
  it("there are five: Timekeeper, Warehouse man, Leadman, General Foreman, On-site worker", () => {
    expect(JOB_ROLE_KEYS.map((k) => JOB_ROLES[k].label)).toEqual(["Timekeeper", "Warehouse man", "Leadman", "General Foreman", "On-site worker"]);
  });
  it("each sits on an account type: a General Foreman is a Foreman, the rest are office-type staff accounts", () => {
    expect(JOB_ROLES.GENERAL_FOREMAN.role).toBe("FOREMAN");
    for (const k of ["TIMEKEEPER", "WAREHOUSEMAN", "LEADMAN", "SITE_WORKER"] as const) expect(JOB_ROLES[k].role).toBe("OFFICE");
  });
  it("picking a job sets the account type and the job; picking a plain account type clears the job", () => {
    expect(resolveAccess({ jobRole: "WAREHOUSEMAN" })).toEqual({ role: "OFFICE", jobRole: "WAREHOUSEMAN" });
    expect(resolveAccess({ role: "PM", jobRole: null })).toEqual({ role: "PM", jobRole: null });
    expect(resolveAccess({ role: "PM", jobRole: "TIMEKEEPER" })).toEqual({ role: "OFFICE", jobRole: "TIMEKEEPER" }); // the job wins
    expect(resolveAccess({ jobRole: "NONSENSE" as never })).toEqual({ role: null, jobRole: null });
    expect(isJobRole("LEADMAN")).toBe(true);
    expect(isJobRole("OWNER")).toBe(false);
    expect(jobRoleLabel("GENERAL_FOREMAN")).toBe("General Foreman");
    expect(jobRoleLabel(null)).toBeNull();
  });
  it("starting tabs: the account type's own plus the job's", () => {
    const base = allowedMenus("OFFICE", null);
    expect(base).toEqual(["/instructions", "/attendance", "/payroll"]);
    expect(jobRoleTabs("SITE_WORKER", base)).toEqual(base);
    expect(jobRoleTabs("TIMEKEEPER", base)).toEqual([...base, "/inventory"]);
    expect(jobRoleTabs("WAREHOUSEMAN", base)).toEqual([...base, "/inventory", "/deliveries"]);
    expect(jobRoleTabs("GENERAL_FOREMAN", allowedMenus("FOREMAN", null))).toEqual(allowedMenus("FOREMAN", null));
  });
});

describe("what each job can do", () => {
  const person = (jobRole: string | null, tabs: string[], over: Record<string, unknown> = {}) => ({ role: "OFFICE" as const, department: "SITE" as const, position: "Worker", jobRole, customMenus: tabs, useCustomMenus: true, ...over });
  it("a timekeeper opens the timekeeper sheet whatever their position says", () => {
    expect(canOpenTimesheets({ role: "OFFICE", position: "Worker", jobRole: "TIMEKEEPER" })).toBe(true);
    expect(canOpenTimesheets({ role: "OFFICE", position: "Timekeeper" })).toBe(true); // existing accounts keep working by position
    expect(canOpenTimesheets({ role: "OFFICE", position: "Worker", jobRole: "LEADMAN" })).toBe(false);
    expect(canOpenTimesheets({ role: "OFFICE", position: "Worker", jobRole: "SITE_WORKER" })).toBe(false);
  });
  it("timekeeper, leadman and warehouse man log materials movements (with the Inventory tab); an on-site worker does not", () => {
    for (const j of ["TIMEKEEPER", "LEADMAN", "WAREHOUSEMAN"]) expect(canLogInventoryMovement(person(j, ["/inventory"])), j).toBe(true);
    expect(canLogInventoryMovement(person("SITE_WORKER", ["/inventory"]))).toBe(false);
    expect(canLogInventoryMovement(person("TIMEKEEPER", ["/attendance"]))).toBe(false); // no Inventory tab, no logging
  });
  it("only the warehouse man adds stock items and tools; timekeepers and leadmen do not", () => {
    expect(canAddInventoryCatalog(person("WAREHOUSEMAN", ["/inventory"]))).toBe(true);
    expect(canAddInventoryCatalog(person("WAREHOUSEMAN", ["/attendance"]))).toBe(false);
    expect(canAddInventoryCatalog(person("TIMEKEEPER", ["/inventory"]))).toBe(false);
    expect(canAddInventoryCatalog(person("LEADMAN", ["/inventory"]))).toBe(false);
  });
  it("they can open and file tally-out forms through the Inventory tab", () => {
    for (const j of ["TIMEKEEPER", "LEADMAN", "WAREHOUSEMAN"]) expect(canUseTallyOuts(person(j, ["/inventory"])), j).toBe(true);
  });
  it("a General Foreman has everything a Foreman has (it is a Foreman account)", () => {
    expect(canLogInventoryMovement({ role: "FOREMAN", department: "SITE", jobRole: "GENERAL_FOREMAN" })).toBe(true);
  });
});
