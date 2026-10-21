import { describe, expect, it } from "vitest";
import type { Department, Role } from "@prisma/client";
import { canAddInventoryCatalog, canApproveInventoryRequest, canDeleteTool, canLogInventoryMovement, canVerifyDelivery, isTimekeeperOrLeadman } from "./access";

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

describe("approving return and transfer requests", () => {
  it("is for the Owner, PM, Purchasing and office staff who have the Inventory tab", () => {
    for (const role of ["OWNER", "PM", "PURCHASING"] as const) expect(canApproveInventoryRequest(person(role, "OFFICE", null, false)), role).toBe(true);
    expect(canApproveInventoryRequest(person("OFFICE", "OFFICE"))).toBe(true);
    expect(canApproveInventoryRequest(person("OFFICE", "ENGINEER"))).toBe(true);
  });

  it("is not for the people who make the requests", () => {
    expect(canApproveInventoryRequest(person("OFFICE", "OFFICE", null, false))).toBe(false); // no Inventory tab
    expect(canApproveInventoryRequest(person("FOREMAN", "SITE"))).toBe(false);
    expect(canApproveInventoryRequest(person("DRIVER", "DRIVER"))).toBe(false);
    expect(canApproveInventoryRequest(person("OFFICE", "DRIVER", "Driver"))).toBe(false);
    expect(canApproveInventoryRequest(person("OFFICE", "SITE", "Timekeeper"))).toBe(false);
    expect(canApproveInventoryRequest(person("OFFICE", "SITE", "Leadman"))).toBe(false);
    expect(canApproveInventoryRequest(person("CLIENT", null))).toBe(false);
  });
});

describe("deleting tools and equipment", () => {
  it("the Owner can delete any tool, moved or not", () => {
    expect(canDeleteTool(person("OWNER", "OFFICE", null, false), 0)).toBe(true);
    expect(canDeleteTool(person("OWNER", "OFFICE", null, false), 12)).toBe(true);
  });

  it("office staff, PM and Purchasing can delete a tool that has never moved (a typing mistake)", () => {
    expect(canDeleteTool(person("OFFICE", "OFFICE"), 0)).toBe(true);
    expect(canDeleteTool(person("PM", "OFFICE"), 0)).toBe(true);
    expect(canDeleteTool(person("PURCHASING", "OFFICE"), 0)).toBe(true);
  });

  it("but not one that already has movement history", () => {
    expect(canDeleteTool(person("OFFICE", "OFFICE"), 1)).toBe(false);
    expect(canDeleteTool(person("PM", "OFFICE"), 3)).toBe(false);
    expect(canDeleteTool(person("PURCHASING", "OFFICE"), 2)).toBe(false);
  });

  it("and never the people who only use tools", () => {
    expect(canDeleteTool(person("FOREMAN", "SITE"), 0)).toBe(false);
    expect(canDeleteTool(person("DRIVER", "DRIVER"), 0)).toBe(false);
    expect(canDeleteTool(person("OFFICE", "SITE", "Timekeeper"), 0)).toBe(false);
    expect(canDeleteTool(person("OFFICE", "OFFICE", null, false), 0)).toBe(false); // office staff without the Inventory tab
  });
});
