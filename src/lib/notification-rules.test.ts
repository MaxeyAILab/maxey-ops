import { describe, expect, it } from "vitest";
import type { Role } from "@prisma/client";
import {
  ALL_CATEGORIES,
  CATEGORY_MENU,
  EVENTS,
  eligibleCategories,
  eventExplicitTitle,
  eventFor,
  eventTitle,
  isQuietNow,
  selectRecipients,
  type EventCtx,
  type RecipientUser,
} from "./notification-rules";

const user = (id: string, role: Role, over: Partial<RecipientUser> = {}): RecipientUser => ({
  id,
  role,
  department: "OFFICE",
  customMenus: [],
  useCustomMenus: false,
  canApprovePettyCash: false,
  canReleasePettyCash: false,
  canManageCash: false,
  ...over,
});

const owner = user("owner", "OWNER");
const pm = user("pm", "PM");
// Arlene: Purchasing, with the tab list the Owner set for her — no Projects tab
const arlene = user("arlene", "PURCHASING", {
  useCustomMenus: true,
  customMenus: ["/requisitions", "/purchasing", "/deliveries", "/inventory", "/instructions", "/attendance", "/payroll"],
  canManageCash: true,
});
const accounting = user("acct", "ACCOUNTING");
const foremanA = user("foremanA", "FOREMAN", { department: "SITE" });
const foremanB = user("foremanB", "FOREMAN", { department: "SITE" });
const driver = user("driver", "DRIVER", { department: "DRIVER" });
const everyone = [owner, pm, arlene, accounting, foremanA, foremanB, driver];

const ctx = (over: Partial<EventCtx> = {}): EventCtx => ({ url: "/x", label: "Calauan Public Market", projectId: "p1", ...over });
const who = (action: string, c: EventCtx, actorId: string | null = null, assigned: string[] = []) => {
  const def = eventFor(action)!;
  return selectRecipients(def, c, everyone, new Set(assigned), actorId).map((r) => r.userId).sort();
};

describe("the Owner is involved in everything", () => {
  it("receives every kind of event", () => {
    for (const action of Object.keys(EVENTS)) expect(who(action, ctx()), action).toContain("owner");
  });

  it("is not told about their own actions", () => {
    for (const action of ["REQUISITION_SUBMITTED", "PROGRESS_REPORTED", "PAYROLL_APPROVED", "PETTY_CASH_APPROVED"]) {
      expect(who(action, ctx(), "owner"), action).not.toContain("owner");
    }
  });
});

describe("Arlene (Purchasing, no Projects tab)", () => {
  it("hears about requisitions, purchase orders and deliveries", () => {
    expect(who("REQUISITION_SUBMITTED", ctx())).toContain("arlene");
    expect(who("REQUISITION_APPROVED", ctx())).toContain("arlene");
    expect(who("PO_CREATED", ctx())).toContain("arlene");
    expect(who("DELIVERY_VERIFIED", ctx())).toContain("arlene");
  });

  it("hears about petty cash because she manages cash", () => {
    expect(who("PETTY_CASH_LIQUIDATION_SUBMITTED", ctx())).toContain("arlene");
    expect(who("PETTY_CASH_FUND_REPLENISHED", ctx())).toContain("arlene");
  });

  it("does NOT get project updates — she has no Projects tab", () => {
    for (const action of ["PROGRESS_REPORTED", "DAILY_REPORT_POSTED", "RFI_RAISED", "CHANGE_ORDER_APPROVED", "MILESTONE_CREATED", "DOCUMENT_ADDED"]) {
      expect(who(action, ctx(), null, ["arlene"]), action).not.toContain("arlene");
    }
  });

  it("is not told payroll runs or payments received", () => {
    expect(who("PAYROLL_APPROVED", ctx())).not.toContain("arlene");
    expect(who("PAYMENT_RECORDED", ctx())).not.toContain("arlene");
  });
});

describe("the tab list decides, not just the role", () => {
  it("a PM has no Purchasing tab by default, so purchase-order news doesn't reach them", () => {
    expect(who("PO_CREATED", ctx())).not.toContain("pm");
  });

  it("giving someone the tab brings the news with it", () => {
    const pmWithPurchasing = user("pm2", "PM", { useCustomMenus: true, customMenus: ["/projects", "/purchasing", "/requisitions"] });
    const got = selectRecipients(eventFor("PO_CREATED")!, ctx(), [pmWithPurchasing], new Set(), null).map((r) => r.userId);
    expect(got).toEqual(["pm2"]);
  });

  it("taking away the Projects tab removes project updates", () => {
    const pmNoProjects = user("pm3", "PM", { useCustomMenus: true, customMenus: ["/requisitions"] });
    const got = selectRecipients(eventFor("PROGRESS_REPORTED")!, ctx(), [pmNoProjects], new Set(), null);
    expect(got).toEqual([]);
  });
});

describe("project updates", () => {
  it("go to the PM, and to people assigned to that project — not to other foremen", () => {
    const got = who("PROGRESS_REPORTED", ctx(), null, ["foremanA"]);
    expect(got).toEqual(expect.arrayContaining(["owner", "pm", "foremanA"]));
    expect(got).not.toContain("foremanB");
    expect(got).not.toContain("accounting");
  });

  it("don't go to anyone assigned elsewhere", () => {
    expect(who("PROGRESS_REPORTED", ctx({ projectId: "p2" }), null, [])).not.toContain("foremanA");
  });

  it("tell the person who submitted a progress update how it was reviewed", () => {
    const c = ctx({ explicit: ["foremanA"] });
    const got = selectRecipients(eventFor("PROGRESS_QUERIED")!, c, everyone, new Set(), "pm");
    expect(got.find((r) => r.userId === "foremanA")).toEqual({ userId: "foremanA", explicit: true });
    expect(got.find((r) => r.userId === "owner")?.explicit).toBe(false);
  });
});

describe("things that are about you reach you directly", () => {
  it("a foreman is told his requisition was approved even though requisitions aren't a foreman's general business", () => {
    expect(who("REQUISITION_APPROVED", ctx({ explicit: ["foremanA"] }), "owner")).toContain("foremanA");
    expect(who("REQUISITION_APPROVED", ctx({ explicit: ["foremanA"] }), "owner")).not.toContain("foremanB");
  });

  it("explicit people get the personal wording", () => {
    const def = eventFor("REQUISITION_APPROVED")!;
    expect(eventTitle(def, ctx())).toMatch(/ready for a purchase order/);
    expect(eventExplicitTitle(def, ctx())).toBe("Your requisition was approved");
  });

  it("each person on an approved payroll hears about their own payslip; nobody else on staff does", () => {
    const got = who("PAYROLL_APPROVED", ctx({ explicit: ["foremanA", "driver"] }), "owner");
    expect(got).toEqual(expect.arrayContaining(["foremanA", "driver", "acct"]));
    expect(got).not.toContain("foremanB");
    expect(eventExplicitTitle(eventFor("PAYROLL_APPROVED")!, ctx())).toBe("Your payslip is ready");
  });

  it("a person who is also the actor is never told about their own action", () => {
    expect(who("REQUISITION_APPROVED", ctx({ explicit: ["foremanA"] }), "foremanA")).not.toContain("foremanA");
  });
});

describe("cash expense follows the approver / releaser / custodian switches", () => {
  const approver = user("approver", "OFFICE", { canApprovePettyCash: true });
  const releaser = user("releaser", "OFFICE", { canReleasePettyCash: true });
  const staff = [owner, approver, releaser, accounting, arlene, foremanA];
  const pick = (action: string, c = ctx()) => selectRecipients(eventFor(action)!, c, staff, new Set(), null).map((r) => r.userId).sort();

  it("a new petty cash request goes to the Owner and the approvers only", () => {
    expect(pick("PETTY_CASH_REQUESTED")).toEqual(["approver", "owner"]);
  });

  it("an approved request goes to the releasers, and to the requester", () => {
    expect(pick("PETTY_CASH_APPROVED", ctx({ explicit: ["foremanA"] }))).toEqual(["foremanA", "owner", "releaser"]);
  });

  it("a submitted expense report goes to the custodians (Owner, Accounting, full cash access)", () => {
    expect(pick("PETTY_CASH_LIQUIDATION_SUBMITTED")).toEqual(["acct", "arlene", "owner"]);
  });

  it("a report turned in without a receipt is raised to the custodians with a warning, not the ordinary wording", () => {
    expect(pick("PETTY_CASH_LIQUIDATION_NO_RECEIPT")).toEqual(["acct", "arlene", "owner"]);
    expect(eventTitle(eventFor("PETTY_CASH_LIQUIDATION_NO_RECEIPT")!, ctx())).toMatch(/WITHOUT a receipt/);
  });

  it("a receipt added later tells the custodians", () => {
    expect(pick("PETTY_CASH_RECEIPT_ADDED")).toEqual(["acct", "arlene", "owner"]);
  });

  it("a rejected request reaches only its requester (and the Owner)", () => {
    expect(pick("PETTY_CASH_REJECTED", ctx({ explicit: ["foremanA"] }))).toEqual(["foremanA", "owner"]);
  });
});

describe("inventory requests", () => {
  const officeStaff = user("office", "OFFICE", { department: "OFFICE", useCustomMenus: true, customMenus: ["/inventory", "/attendance"] });
  const officeNoTab = user("office2", "OFFICE", { department: "OFFICE", useCustomMenus: true, customMenus: ["/attendance"] });
  const crew = user("crew", "OFFICE", { department: "SITE", useCustomMenus: true, customMenus: ["/inventory"] });
  const staff = [owner, pm, arlene, accounting, foremanA, driver, officeStaff, officeNoTab, crew];
  const pick = (action: string, c = ctx(), actor: string | null = null) => selectRecipients(eventFor(action)!, c, staff, new Set(), actor).map((r) => r.userId).sort();

  it("a new request goes to the Owner, PM, Purchasing and office staff with the Inventory tab — not the foremen, drivers and site crew who make requests", () => {
    expect(pick("INVENTORY_REQUEST_SUBMITTED")).toEqual(["acct", "arlene", "office", "owner", "pm"]); // Accounting is office staff too
    expect(pick("TOOL_REQUEST_SUBMITTED")).toEqual(["acct", "arlene", "office", "owner", "pm"]);
  });

  it("the person who asked is not told about their own request", () => {
    expect(pick("INVENTORY_REQUEST_SUBMITTED", ctx(), "office")).not.toContain("office");
  });

  it("the decision goes to whoever asked, in their own words", () => {
    const c = ctx({ explicit: ["crew"] });
    expect(pick("INVENTORY_REQUEST_APPROVED", c, "office")).toEqual(["crew", "owner"]);
    expect(pick("TOOL_REQUEST_REJECTED", c, "office")).toEqual(["crew", "owner"]);
    expect(eventExplicitTitle(eventFor("INVENTORY_REQUEST_APPROVED")!, c)).toBe("Your inventory request was approved");
    expect(eventExplicitTitle(eventFor("TOOL_REQUEST_REJECTED")!, c)).toBe("Your tool request was rejected");
  });

  it("people with the Inventory tab can mute or unmute Inventory notifications", () => {
    expect(eligibleCategories(officeStaff)).toContain("INVENTORY");
    expect(eligibleCategories(officeNoTab)).not.toContain("INVENTORY");
  });
});

describe("what each person's settings page lists", () => {
  it("the Owner sees every category", () => {
    expect(eligibleCategories(owner)).toEqual(ALL_CATEGORIES);
  });

  it("Arlene sees purchasing-side categories but not projects, leads, security or payments received", () => {
    const cats = eligibleCategories(arlene);
    expect(cats).toEqual(expect.arrayContaining(["REQUISITIONS", "PURCHASING", "DELIVERIES", "CASH", "PAYROLL", "INSTRUCTIONS", "ATTENDANCE"]));
    for (const c of ["PROJECTS", "LEADS", "SECURITY", "FINANCE"]) expect(cats).not.toContain(c);
  });

  it("Accounting sees payments received", () => {
    expect(eligibleCategories(accounting)).toContain("FINANCE");
  });

  it("everyone staff-side sees their own cash and payslip categories", () => {
    for (const u of [pm, foremanA, driver]) expect(eligibleCategories(u)).toEqual(expect.arrayContaining(["CASH", "PAYROLL"]));
  });
});

describe("quiet hours (Manila time)", () => {
  const at = (hhmm: string) => new Date(`2026-10-20T${hhmm}:00+08:00`);

  it("handles a range that crosses midnight", () => {
    const p = { quietStart: 21, quietEnd: 6 };
    expect(isQuietNow(p, at("23:30"))).toBe(true);
    expect(isQuietNow(p, at("02:00"))).toBe(true);
    expect(isQuietNow(p, at("05:59"))).toBe(true);
    expect(isQuietNow(p, at("06:00"))).toBe(false);
    expect(isQuietNow(p, at("12:00"))).toBe(false);
    expect(isQuietNow(p, at("20:59"))).toBe(false);
    expect(isQuietNow(p, at("21:00"))).toBe(true);
  });

  it("handles a range within one day", () => {
    const p = { quietStart: 12, quietEnd: 13 };
    expect(isQuietNow(p, at("12:30"))).toBe(true);
    expect(isQuietNow(p, at("13:00"))).toBe(false);
  });

  it("is off when not set, half set, or the same hour", () => {
    expect(isQuietNow(null, at("03:00"))).toBe(false);
    expect(isQuietNow({ quietStart: null, quietEnd: null }, at("03:00"))).toBe(false);
    expect(isQuietNow({ quietStart: 21, quietEnd: null }, at("23:00"))).toBe(false);
    expect(isQuietNow({ quietStart: 8, quietEnd: 8 }, at("08:30"))).toBe(false);
  });

  it("uses Manila's hour, not the server's", () => {
    // 15:30 UTC is 23:30 in Manila
    expect(isQuietNow({ quietStart: 22, quietEnd: 5 }, new Date("2026-10-20T15:30:00Z"))).toBe(true);
  });
});

describe("the catalogue", () => {
  const sample = ctx({ label: "PC-0012 · Calauan Public Market", actorName: "Elena Reyes" });

  it("only uses known categories, and every tab it relies on is a real tab", () => {
    for (const [action, def] of Object.entries(EVENTS)) {
      expect(ALL_CATEGORIES, action).toContain(def.category);
    }
    for (const menu of Object.values(CATEGORY_MENU)) expect(menu).toMatch(/^\//);
  });

  it("never puts an amount in a notification", () => {
    for (const [action, def] of Object.entries(EVENTS)) {
      const text = [eventTitle(def, sample), eventExplicitTitle(def, sample), def.body?.(sample) ?? ""].join(" ");
      expect(text, action).not.toMatch(/₱|PHP|\bP\d|\d,\d{3}/);
    }
  });

  it("says who did it and what it's about, but leaves out system actors", () => {
    const body = eventFor("REQUISITION_SUBMITTED")!.body!(sample);
    expect(body).toContain("Elena Reyes");
    expect(body).toContain("Calauan Public Market");
    expect(eventFor("REQUISITION_SUBMITTED")!.body!({ ...sample, actorName: "system (go-live)" })).not.toContain("system");
  });

  it("covers the actions the app builds from a status", () => {
    for (const a of ["INSTRUCTION_COMPLETED", "INSTRUCTION_FOR_REVIEW", "TIME_ADJUSTMENT_APPROVED", "TIME_ADJUSTMENT_REJECTED", "PAYROLL_REVIEW", "PAYROLL_APPROVED", "PAYROLL_PAID", "CHANGE_ORDER_APPROVED", "CHANGE_ORDER_REJECTED"]) {
      expect(eventFor(a), a).not.toBeNull();
    }
  });

  it("ignores noisy or irrelevant actions", () => {
    for (const a of ["TIME_IN", "TIME_OUT", "PASSWORD_CHANGED", "PAYROLL_EXPORTED", "SOMETHING_NEW"]) expect(eventFor(a), a).toBeNull();
  });
});
