import { describe, expect, it } from "vitest";
import type { Department, Role } from "@prisma/client";
import { canAddInventoryCatalog, canLogInventoryMovement, canVerifyDelivery, isTimekeeperOrLeadman } from "./access";

describe("who can verify a delivery", () => {
  it("includes a driver whose account is Office staff in the Driver department", () => {
    expect(canVerifyDelivery("OFFICE", "DRIVER")).toBe(true);
  });

  it("still includes the roles and the engineers it always did", () => {
    for (const role of ["FOREMAN", "PM", "OWNER", "DRIVER"] as const) expect(canVerifyDelivery(role, null), role).toBe(true);
    expect(canVerifyDelivery("OFFICE", "ENGINEER")).toBe(true);
  });

  it("does not include other office staff, purchasing, accounting or clients", () => {
    expect(canVerifyDelivery("OFFICE", "OFFICE")).toBe(false);
    expect(canVerifyDelivery("OFFICE", "SITE")).toBe(false);
    expect(canVerifyDelivery("OFFICE", null)).toBe(false);
    expect(canVerifyDelivery("PURCHASING", "OFFICE")).toBe(false);
    expect(canVerifyDelivery("ACCOUNTING", null)).toBe(false);
    expect(canVerifyDelivery("CLIENT", null)).toBe(false);
  });
});

const person = (role: Role, department: Department | null, position: string | null = null, withInventory = true) => ({
  role,
  department,
  position,
  useCustomMenus: true,
  customMenus: withInventory ? ["/attendance", "/inventory"] : ["/attendance"],
});

describe("timekeepers and leadmen are recognised by their position", () => {
  it("accepts the usual spellings", () => {
    for (const p of ["Timekeeper", "Timekeeper/Electrician", "time keeper", "Time-keeper", "Leadman", "Lead man", "lead-man", "Leadmen", "Leadman / Mason"]) expect(isTimekeeperOrLeadman(p), p).toBe(true);
  });

  it("does not match other positions", () => {
    for (const p of ["Foreman", "General Foreman", "Mason", "Carpenter", "Welder", "Driver", "Admin Asst.", "Leader of the pack", "Misleading", "", null, undefined]) expect(isTimekeeperOrLeadman(p as string), String(p)).toBe(false);
  });
});

describe("adding stock items and tools", () => {
  it("is open to the Owner, PM and Purchasing as before", () => {
    for (const role of ["OWNER", "PM", "PURCHASING"] as const) expect(canAddInventoryCatalog(person(role, "OFFICE", null, false)), role).toBe(true);
  });

  it("is now open to office staff who have the Inventory tab", () => {
    expect(canAddInventoryCatalog(person("OFFICE", "OFFICE"))).toBe(true);
    expect(canAddInventoryCatalog(person("OFFICE", "ARCHITECT"))).toBe(true);
    expect(canAddInventoryCatalog(person("OFFICE", "ENGINEER"))).toBe(true);
  });

  it("needs the Inventory tab for office staff", () => {
    expect(canAddInventoryCatalog(person("OFFICE", "OFFICE", null, false))).toBe(false);
  });

  it("is not open to site workers, drivers, foremen or timekeepers", () => {
    expect(canAddInventoryCatalog(person("OFFICE", "SITE"))).toBe(false);
    expect(canAddInventoryCatalog(person("OFFICE", "SITE", "Timekeeper"))).toBe(false);
    expect(canAddInventoryCatalog(person("DRIVER", "DRIVER"))).toBe(false);
    expect(canAddInventoryCatalog(person("OFFICE", "DRIVER", "Driver"))).toBe(false);
    expect(canAddInventoryCatalog(person("FOREMAN", "SITE"))).toBe(false);
    expect(canAddInventoryCatalog(person("CLIENT", null))).toBe(false);
  });
});

describe("logging stock and tool movements", () => {
  it("keeps Foreman, PM, Owner and Purchasing as before", () => {
    for (const role of ["FOREMAN", "PM", "OWNER", "PURCHASING"] as const) expect(canLogInventoryMovement(person(role, "SITE", null, false)), role).toBe(true);
  });

  it("now includes office staff, drivers (account or department), timekeepers and leadmen who have the Inventory tab", () => {
    expect(canLogInventoryMovement(person("OFFICE", "OFFICE"))).toBe(true);
    expect(canLogInventoryMovement(person("DRIVER", "DRIVER", "Driver"))).toBe(true);
    expect(canLogInventoryMovement(person("OFFICE", "DRIVER", "Driver"))).toBe(true);
    expect(canLogInventoryMovement(person("DRIVER", "SITE", "Timekeeper/Electrician"))).toBe(true);
    expect(canLogInventoryMovement(person("OFFICE", "SITE", "Timekeeper"))).toBe(true);
    expect(canLogInventoryMovement(person("OFFICE", "SITE", "Leadman"))).toBe(true);
  });

  it("still needs the Inventory tab for the newly included people", () => {
    expect(canLogInventoryMovement(person("OFFICE", "OFFICE", null, false))).toBe(false);
    expect(canLogInventoryMovement(person("DRIVER", "DRIVER", "Driver", false))).toBe(false);
    expect(canLogInventoryMovement(person("OFFICE", "SITE", "Leadman", false))).toBe(false);
  });

  it("does not include ordinary site workers or clients", () => {
    expect(canLogInventoryMovement(person("OFFICE", "SITE", "Mason"))).toBe(false);
    expect(canLogInventoryMovement(person("OFFICE", "SITE", null))).toBe(false);
    expect(canLogInventoryMovement(person("CLIENT", null))).toBe(false);
  });
});
