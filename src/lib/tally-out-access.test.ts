import { describe, expect, it } from "vitest";
import type { Role } from "@prisma/client";
import { canFileTallyOut, canUseTallyOuts } from "./access";
import { EVENTS, selectRecipients, type RecipientUser } from "./notification-rules";
import { canApproveTallyOut } from "./tally-out";

const person = (role: Role, department: string | null, over: Record<string, unknown> = {}) => ({ role, department: department as never, position: null, customMenus: [] as string[], useCustomMenus: false, ...over });
const rec = (id: string, role: Role, department: string | null, over: Partial<RecipientUser> = {}): RecipientUser => ({
  id, role, department, customMenus: [], useCustomMenus: false, canApprovePettyCash: false, canReleasePettyCash: false, canManageCash: false, canApproveTallyOut: false, ...over,
});

describe("who can open and file tally-out forms", () => {
  it("drivers (a Driver account, or an office account in the Driver department) can, whatever tabs they have", () => {
    expect(canUseTallyOuts(person("DRIVER", "DRIVER"))).toBe(true);
    expect(canUseTallyOuts(person("OFFICE", "DRIVER"))).toBe(true);
    expect(canFileTallyOut(person("DRIVER", "SITE"))).toBe(true);
    expect(canFileTallyOut(person("OFFICE", "DRIVER", { useCustomMenus: true, customMenus: ["/attendance"] }))).toBe(true);
  });
  it("office staff (Office, Architect and Engineer departments) can, even without the Inventory tab", () => {
    for (const d of ["OFFICE", "ARCHITECT", "ENGINEER"]) {
      expect(canUseTallyOuts(person("OFFICE", d)), d).toBe(true);
      expect(canFileTallyOut(person("OFFICE", d)), d).toBe(true);
    }
  });
  it("whoever has the Inventory tab can open it (foremen, PM, Purchasing)", () => {
    for (const r of ["FOREMAN", "PM", "OWNER", "PURCHASING"] as Role[]) expect(canUseTallyOuts(person(r, "SITE")), r).toBe(true);
  });
  it("site workers without the Inventory tab, and clients, cannot", () => {
    expect(canUseTallyOuts(person("OFFICE", "SITE"))).toBe(false);
    expect(canFileTallyOut(person("OFFICE", "SITE"))).toBe(false);
    expect(canUseTallyOuts(person("CLIENT", null))).toBe(false);
    expect(canFileTallyOut(person("CLIENT", null))).toBe(false);
  });
});

describe("approval stays with the Owner and the person the Owner switched on", () => {
  it("drivers and office staff may file and verify but never approve", () => {
    expect(canApproveTallyOut({ id: "d", role: "DRIVER", department: "DRIVER" })).toBe(false);
    expect(canApproveTallyOut({ id: "o", role: "OFFICE", department: "OFFICE" })).toBe(false);
    expect(canApproveTallyOut({ id: "p", role: "PURCHASING", department: "OFFICE" })).toBe(false);
    expect(canApproveTallyOut({ id: "pm", role: "PM", department: "OFFICE" })).toBe(false);
    expect(canApproveTallyOut({ id: "joseph", role: "PM", department: "OFFICE", canApproveTallyOut: true })).toBe(true);
    expect(canApproveTallyOut({ id: "jacob", role: "OWNER", department: "OFFICE" })).toBe(true);
  });
  const users = [
    rec("jacob", "OWNER", "OFFICE"),
    rec("joseph", "PM", "OFFICE", { canApproveTallyOut: true }),
    rec("pm", "PM", "OFFICE"),
    rec("arlene", "PURCHASING", "OFFICE"),
    rec("clerk", "OFFICE", "OFFICE"),
    rec("driver", "DRIVER", "DRIVER", { customMenus: [], useCustomMenus: true }),
    rec("zoilo", "OFFICE", "DRIVER"),
  ];
  const ids = (action: string, explicit: string[] = [], actor: string | null = null) =>
    selectRecipients(EVENTS[action], { url: "/x", explicit }, users, new Set(), actor).map((r) => r.userId).sort();
  it("only the Owner and Joseph are told a form is waiting for approval", () => {
    expect(ids("TALLYOUT_SUBMITTED", [], "arlene")).toEqual(["jacob", "joseph"]);
  });
  it("when a form is approved the drivers are told, even a driver with no Inventory tab, plus whoever filed it", () => {
    expect(ids("TALLYOUT_APPROVED", ["clerk"], "jacob")).toEqual(["clerk", "driver", "zoilo"]);
  });
});
