import type { Role } from "@prisma/client";
import { allowedMenus, canApproveInventoryRequest } from "@/lib/access";

/**
 * Who gets told about what. Pure rules — no database — so they can be tested directly.
 *
 * Every action in the app already writes an audit record. Each kind of record that matters is listed in EVENTS below with
 * the category it belongs to and who is involved. A person is involved when:
 *   - they are the Owner (involved in everything), or
 *   - their role is one of the roles named for that event AND they have the tab that category lives in (so the tab
 *     checklist the Owner sets per person also decides what they hear about — someone with no Projects tab never gets
 *     project updates), or
 *   - they are assigned to the project the event is about (for project events), or
 *   - the event is directly about them (they filed it, it is assigned to them, it is their payslip…).
 * The person who did the thing is never told about their own action.
 */

export type NotificationCategory =
  | "REQUISITIONS"
  | "PURCHASING"
  | "DELIVERIES"
  | "INVENTORY"
  | "CASH"
  | "PROJECTS"
  | "INSTRUCTIONS"
  | "ATTENDANCE"
  | "PAYROLL"
  | "FINANCE"
  | "LEADS"
  | "SECURITY";

export const CATEGORY_LABEL: Record<NotificationCategory, string> = {
  REQUISITIONS: "Requisitions",
  PURCHASING: "Purchase orders",
  DELIVERIES: "Deliveries",
  INVENTORY: "Inventory & tools",
  CASH: "Cash expense (petty cash, cash advances)",
  PROJECTS: "Project updates",
  INSTRUCTIONS: "Site instructions",
  ATTENDANCE: "Time & attendance requests",
  PAYROLL: "Payroll & payslips",
  FINANCE: "Payments received",
  LEADS: "Leads & quotations",
  SECURITY: "Security & accounts",
};

/** The tab each category lives in; a person needs that tab to hear about it unless the event is directly about them. */
export const CATEGORY_MENU: Partial<Record<NotificationCategory, string>> = {
  REQUISITIONS: "/requisitions",
  PURCHASING: "/purchasing",
  DELIVERIES: "/deliveries",
  INVENTORY: "/inventory",
  PROJECTS: "/projects",
  INSTRUCTIONS: "/instructions",
  ATTENDANCE: "/attendance",
  PAYROLL: "/payroll",
};

export const ALL_CATEGORIES = Object.keys(CATEGORY_LABEL) as NotificationCategory[];

export interface RecipientUser {
  id: string;
  role: Role;
  department: string | null;
  customMenus: string[];
  useCustomMenus: boolean;
  canApprovePettyCash: boolean;
  canReleasePettyCash: boolean;
  canManageCash: boolean;
  canApproveTallyOut: boolean;
}

/** Whether a person's tab access includes the tab a category lives in (always true for categories with no tab). */
export function hasCategoryMenu(u: RecipientUser, category: NotificationCategory): boolean {
  const menu = CATEGORY_MENU[category];
  if (!menu) return true;
  return allowedMenus(u.role, u.department as never, u.customMenus, u.useCustomMenus).includes(menu);
}

export type AudienceToken = "cashApprovers" | "cashReleasers" | "cashCustodians" | "inventoryApprovers" | "tallyOutApprovers" | "drivers";

const TOKEN_TEST: Record<AudienceToken, (u: RecipientUser) => boolean> = {
  // whoever may approve a tally-out form: the Owner, and a person the Owner switched on
  // drivers, whether their account is a Driver account or an office account in the Driver department
  drivers: (u) => u.role === "DRIVER" || u.department === "DRIVER",
  tallyOutApprovers: (u) => u.role === "OWNER" || u.canApproveTallyOut,
  cashApprovers: (u) => u.role === "OWNER" || u.canApprovePettyCash,
  cashReleasers: (u) => u.role === "OWNER" || u.canReleasePettyCash,
  cashCustodians: (u) => u.role === "OWNER" || u.role === "ACCOUNTING" || u.canManageCash,
  // whoever may approve a return/transfer request on the Inventory tab
  inventoryApprovers: (u) => canApproveInventoryRequest({ role: u.role, department: u.department as never, customMenus: u.customMenus, useCustomMenus: u.useCustomMenus }),
};

/** What a resolver learned about the record an event is about. */
export interface EventCtx {
  projectId?: string | null;
  projectName?: string | null;
  /** A short human reference, e.g. "PC-0012" or the project name. Never an amount. */
  label?: string | null;
  /** Where tapping the notification goes. */
  url: string;
  /** Where it goes for the people the event is directly about, when that differs (e.g. an employee's own pay page). */
  explicitUrl?: string;
  /** People the event is directly about. */
  explicit?: string[];
  actorName?: string | null;
}

export interface EventDef {
  category: NotificationCategory;
  title: string | ((c: EventCtx) => string);
  body?: (c: EventCtx) => string;
  /** Roles generally involved (they also need the category's tab). The Owner always receives every event. */
  roles?: Role[];
  tokens?: AudienceToken[];
  /** People assigned to the event's project (they also need the category's tab). */
  projectCrew?: boolean;
  /** Wording for the people the event is directly about, when it should differ from everyone else's. */
  explicitTitle?: string | ((c: EventCtx) => string);
}

const text = (v: string | ((c: EventCtx) => string), c: EventCtx) => (typeof v === "function" ? v(c) : v);
export const eventTitle = (d: EventDef, c: EventCtx) => text(d.title, c);
export const eventExplicitTitle = (d: EventDef, c: EventCtx) => (d.explicitTitle ? text(d.explicitTitle, c) : text(d.title, c));
const where = (c: EventCtx) => c.label ?? c.projectName ?? "";
const who = (c: EventCtx) => (c.actorName && !c.actorName.toLowerCase().startsWith("system") ? c.actorName : "");
const bodyOf = (c: EventCtx) => [who(c), where(c), "Tap to open"].filter(Boolean).join(" · ");

const ADMIN_CASH: AudienceToken[] = ["cashCustodians"];
const DESK: Role[] = ["PM", "PURCHASING", "ACCOUNTING"];

/**
 * The catalogue: audit action → who is involved and what to say. Anything not listed (clock-ins, logins, edits too small
 * to matter) does not notify. Messages carry a reference but never an amount; the app itself enforces who may see detail.
 */
export const EVENTS: Record<string, EventDef> = {
  // ----- requisitions -----
  REQUISITION_SUBMITTED: { category: "REQUISITIONS", roles: ["PM", "PURCHASING", "ACCOUNTING"], title: "New requisition submitted", body: bodyOf },
  REQUISITION_APPROVED: { category: "REQUISITIONS", roles: ["PURCHASING", "ACCOUNTING"], title: "Requisition approved — ready for a purchase order", explicitTitle: "Your requisition was approved", body: bodyOf },
  REQUISITION_REJECTED: { category: "REQUISITIONS", roles: [], title: "Requisition rejected", explicitTitle: "Your requisition was rejected", body: bodyOf },
  REQUISITION_QUOTE_ADDED: { category: "REQUISITIONS", roles: ["PURCHASING"], title: "A supplier quotation was added to a requisition", body: bodyOf },
  REQUISITION_QUOTE_SELECTED: { category: "REQUISITIONS", roles: ["PURCHASING"], title: "A supplier quotation was selected", body: bodyOf },
  REQUISITION_DELETED: { category: "REQUISITIONS", roles: [], title: "A requisition was deleted", body: bodyOf },

  // ----- purchasing & deliveries -----
  PO_CREATED: { category: "PURCHASING", roles: DESK, title: "Purchase order issued", explicitTitle: "A purchase order was issued for your requisition", body: bodyOf },
  PO_CANCELLED: { category: "PURCHASING", roles: DESK, title: "Purchase order cancelled", explicitTitle: "The purchase order for your requisition was cancelled", body: bodyOf },
  DELIVERY_VERIFIED: { category: "DELIVERIES", roles: [...DESK, "DRIVER"], projectCrew: true, title: "Delivery received and verified", explicitTitle: "Your ordered materials were delivered", body: bodyOf },
  DELIVERY_VERIFIED_WITH_DISCREPANCIES: { category: "DELIVERIES", roles: [...DESK, "DRIVER"], projectCrew: true, title: "Delivery received WITH discrepancies", explicitTitle: "Your delivery arrived with discrepancies", body: bodyOf },
  DELIVERY_AWAITING_CONFIRMATION: { category: "DELIVERIES", roles: [], title: "Delivery verified by the driver — waiting for the receiver", explicitTitle: "A delivery is waiting for your confirmation", body: bodyOf },
  DELIVERY_DISPUTED: { category: "DELIVERIES", roles: DESK, title: "The receiver reported a problem with a delivery", explicitTitle: "The receiver reported a problem with your delivery", body: bodyOf },
  DELIVERY_EDITED: { category: "DELIVERIES", roles: DESK, title: "Delivery record corrected by the Owner", body: bodyOf },
  DELIVERY_ACCEPTED_BY_OWNER: { category: "DELIVERIES", roles: DESK, title: "Delivery accepted by the Owner — PO and requisition adjusted", body: bodyOf },
  DELIVERY_ACCEPTANCE_UNDONE: { category: "DELIVERIES", roles: DESK, title: "Owner's delivery acceptance was undone", body: bodyOf },
  DELIVERY_DELETED: { category: "DELIVERIES", roles: [], title: "A delivery record was deleted", body: bodyOf },

  // ----- inventory & tools (Owner always; others only if given the role below) -----
  WAREHOUSE_ITEM_CREATED: { category: "INVENTORY", roles: [], title: "New warehouse item added", body: bodyOf },
  TOOL_REGISTERED: { category: "INVENTORY", roles: [], title: "New tool registered", body: bodyOf },
  // returns and transfers are requests that office staff approve
  INVENTORY_REQUEST_SUBMITTED: { category: "INVENTORY", tokens: ["inventoryApprovers"], title: "Inventory request waiting for approval", body: bodyOf },
  INVENTORY_REQUEST_APPROVED: { category: "INVENTORY", roles: [], title: "Inventory request approved", explicitTitle: "Your inventory request was approved", body: bodyOf },
  INVENTORY_REQUEST_REJECTED: { category: "INVENTORY", roles: [], title: "Inventory request rejected", explicitTitle: "Your inventory request was rejected", body: bodyOf },
  TOOL_REQUEST_SUBMITTED: { category: "INVENTORY", tokens: ["inventoryApprovers"], title: "Tool request waiting for approval", body: bodyOf },
  TOOL_REQUEST_APPROVED: { category: "INVENTORY", roles: [], title: "Tool request approved", explicitTitle: "Your tool request was approved", body: bodyOf },
  TOOL_REQUEST_REJECTED: { category: "INVENTORY", roles: [], title: "Tool request rejected", explicitTitle: "Your tool request was rejected", body: bodyOf },

  // ----- tally-out forms: materials leaving the warehouse for a project -----
  TALLYOUT_SUBMITTED: { category: "INVENTORY", tokens: ["tallyOutApprovers"], title: "Tally-out form waiting for approval", body: bodyOf },
  TALLYOUT_APPROVED: { category: "INVENTORY", tokens: ["drivers"], title: "Tally-out approved — ready for the driver to verify", explicitTitle: "Your tally-out form was approved", body: bodyOf },
  TALLYOUT_REJECTED: { category: "INVENTORY", roles: [], title: "Tally-out form rejected", explicitTitle: "Your tally-out form was rejected", body: bodyOf },
  TALLYOUT_CANCELLED: { category: "INVENTORY", roles: [], title: "Tally-out form cancelled", body: bodyOf },
  TALLYOUT_VERIFIED: { category: "INVENTORY", roles: [], title: "Tally-out verified by the driver — waiting for the receiver", explicitTitle: "A tally-out is waiting for your confirmation", body: bodyOf },
  TALLYOUT_DELIVERED: { category: "INVENTORY", roles: [], title: "Tally-out delivered — materials added to the project", explicitTitle: "Your tally-out was received on site", body: bodyOf },
  TALLYOUT_DISPUTED: { category: "INVENTORY", tokens: ["tallyOutApprovers"], title: "The receiver reported a problem with a tally-out", explicitTitle: "The receiver reported a problem with your delivery", body: bodyOf },

  // ----- cash expense: petty cash and cash advances -----
  PETTY_CASH_REQUESTED: { category: "CASH", tokens: ["cashApprovers"], title: "Petty cash request awaiting approval", body: bodyOf },
  PETTY_CASH_APPROVED: { category: "CASH", tokens: ["cashReleasers"], title: "Petty cash approved — ready to release", explicitTitle: "Your petty cash request was approved", body: bodyOf },
  PETTY_CASH_REJECTED: { category: "CASH", title: "Petty cash request rejected", explicitTitle: "Your petty cash request was rejected", body: bodyOf },
  PETTY_CASH_RELEASED: { category: "CASH", title: "Petty cash released", explicitTitle: "Your petty cash was released — confirm you received it", body: bodyOf },
  PETTY_CASH_RECEIPT_CONFIRMED: { category: "CASH", tokens: ADMIN_CASH, title: "Petty cash receipt confirmed", body: bodyOf },
  PETTY_CASH_LIQUIDATION_SUBMITTED: { category: "CASH", tokens: ADMIN_CASH, title: "Expense report submitted — needs verification", body: bodyOf },
  PETTY_CASH_LIQUIDATION_NO_RECEIPT: { category: "CASH", tokens: ADMIN_CASH, title: "Warning — expense report submitted WITHOUT a receipt", body: bodyOf },
  PETTY_CASH_RECEIPT_ADDED: { category: "CASH", tokens: ADMIN_CASH, title: "Receipt attached to an expense report", body: bodyOf },
  PETTY_CASH_REPORT_EDITED: { category: "CASH", tokens: ADMIN_CASH, title: "Expense report corrected by the Owner", explicitTitle: "Your expense report was corrected by the Owner", body: bodyOf },
  PETTY_CASH_LIQUIDATED: { category: "CASH", title: "Petty cash expense report verified", explicitTitle: "Your petty cash expense report was verified", body: bodyOf },
  PETTY_CASH_LIQUIDATION_SENT_BACK: { category: "CASH", title: "Expense report sent back", explicitTitle: "Your expense report was sent back — please fix it", body: bodyOf },
  PETTY_CASH_APPROVAL_CANCELLED: { category: "CASH", title: "Petty cash approval cancelled", explicitTitle: "The approval of your petty cash request was cancelled", body: bodyOf },
  PETTY_CASH_CANCELLED: { category: "CASH", title: "Petty cash request cancelled", explicitTitle: "Your petty cash request was cancelled", body: bodyOf },
  PETTY_CASH_DELETED: { category: "CASH", title: "A petty cash request was deleted", body: bodyOf },
  PETTY_CASH_FUND_REPLENISHED: { category: "CASH", tokens: ADMIN_CASH, title: "Petty cash fund replenished", body: () => "Tap to open" },
  PETTY_CASH_FUND_ADJUSTED: { category: "CASH", tokens: ADMIN_CASH, title: "Petty cash fund adjusted", body: () => "Tap to open" },
  CASH_ADVANCE_REQUESTED: { category: "CASH", tokens: ["cashApprovers"], title: "Cash advance awaiting approval", body: bodyOf },
  CASH_ADVANCE_APPROVED: { category: "CASH", title: "Cash advance approved", explicitTitle: "Your cash advance was approved", body: bodyOf },
  CASH_ADVANCE_REJECTED: { category: "CASH", title: "Cash advance rejected", explicitTitle: "Your cash advance was rejected", body: bodyOf },
  CASH_ADVANCE_CANCELLED: { category: "CASH", title: "Cash advance cancelled", explicitTitle: "Your cash advance was cancelled", body: bodyOf },
  CASH_ADVANCE_PAYMENT_RECORDED: { category: "CASH", title: "Cash advance payment recorded", explicitTitle: "A payment on your cash advance was recorded", body: bodyOf },
  CASH_ADVANCE_DEDUCTION_CHANGED: { category: "CASH", title: "Cash advance deduction changed", explicitTitle: "Your cash advance deduction was changed", body: bodyOf },

  // ----- projects -----
  PROGRESS_REPORTED: { category: "PROJECTS", roles: ["PM"], projectCrew: true, title: "Progress update submitted", body: bodyOf },
  PROGRESS_APPROVED: { category: "PROJECTS", roles: [], title: "Progress update approved", explicitTitle: "Your progress update was approved", body: bodyOf },
  PROGRESS_QUERIED: { category: "PROJECTS", roles: [], title: "A progress update was queried", explicitTitle: "Your progress update needs a correction", body: bodyOf },
  DAILY_REPORT_POSTED: { category: "PROJECTS", roles: ["PM"], projectCrew: true, title: "Daily construction report filed", body: bodyOf },
  MILESTONE_CREATED: { category: "PROJECTS", roles: ["PM"], title: "Milestone added", body: bodyOf },
  MILESTONE_BASELINE_REVISED: { category: "PROJECTS", roles: ["PM"], title: "A milestone baseline was revised", body: bodyOf },
  MILESTONE_TEMPLATE_APPLIED: { category: "PROJECTS", roles: ["PM"], title: "A milestone template was applied", body: bodyOf },
  RFI_RAISED: { category: "PROJECTS", roles: ["PM"], title: "New RFI raised", explicitTitle: "An RFI was assigned to you", body: bodyOf },
  RFI_ANSWERED: { category: "PROJECTS", roles: ["PM"], title: "An RFI was answered", explicitTitle: "Your RFI was answered", body: bodyOf },
  RFI_CLOSED: { category: "PROJECTS", roles: [], title: "An RFI was closed", body: bodyOf },
  RFI_REOPENED: { category: "PROJECTS", roles: ["PM"], title: "An RFI was reopened", explicitTitle: "An RFI was reopened — a new answer is needed", body: bodyOf },
  FINDING_RAISED: { category: "PROJECTS", roles: ["PM"], title: "Quality / safety finding raised", explicitTitle: "A finding was assigned to you", body: bodyOf },
  FINDING_CLOSURE_SUBMITTED: { category: "PROJECTS", roles: ["PM"], title: "A finding is ready to be closed", body: bodyOf },
  FINDING_CLOSED: { category: "PROJECTS", roles: [], title: "A finding was closed", body: bodyOf },
  FINDING_SENT_BACK: { category: "PROJECTS", roles: [], title: "A finding was sent back", explicitTitle: "A finding was sent back to you", body: bodyOf },
  CHANGE_ORDER_CREATED: { category: "PROJECTS", roles: ["PM"], title: "Change order created", body: bodyOf },
  CHANGE_ORDER_SENT: { category: "PROJECTS", roles: ["PM"], title: "Change order sent to the client", body: bodyOf },
  CHANGE_ORDER_APPROVED: { category: "PROJECTS", roles: ["PM", "ACCOUNTING"], title: "Change order APPROVED by the client", body: bodyOf },
  CHANGE_ORDER_REJECTED: { category: "PROJECTS", roles: ["PM"], title: "Change order rejected by the client", body: bodyOf },
  WORK_REQUEST_SUBMITTED: { category: "PROJECTS", roles: ["PM"], title: "New client request", body: bodyOf },
  WORK_REQUEST_RECORDED: { category: "PROJECTS", roles: ["PM"], title: "A client instruction was recorded", body: bodyOf },
  WORK_REQUEST_CONVERTED: { category: "PROJECTS", roles: ["PM"], title: "A client request was priced and sent as a quotation", body: bodyOf },
  WORK_REQUEST_DECLINED: { category: "PROJECTS", roles: ["PM"], title: "A client request was declined", body: bodyOf },
  DOCUMENT_ADDED: { category: "PROJECTS", roles: ["PM"], projectCrew: true, title: "New project document", body: bodyOf },
  DOCUMENT_REVISION_ADDED: { category: "PROJECTS", roles: ["PM"], projectCrew: true, title: "A document has a new revision", body: bodyOf },
  PROJECT_STATUS_CHANGED: { category: "PROJECTS", roles: ["PM"], projectCrew: true, title: "Project status changed", body: bodyOf },
  PROJECT_CREATED_FROM_LEAD: { category: "PROJECTS", roles: ["PM"], title: "A new project was created", body: bodyOf },
  PROJECT_CREATED_MANUALLY: { category: "PROJECTS", roles: ["PM"], title: "A new project was added", body: bodyOf },
  NON_CORPORATE_JOB_CREATED: { category: "PROJECTS", roles: [], title: "A non-corporate job was added", body: bodyOf },
  EMPLOYEE_ASSIGNED: { category: "PROJECTS", roles: [], title: "An employee was assigned to a project", explicitTitle: "You were assigned to a project", body: bodyOf },
  EMPLOYEE_UNASSIGNED: { category: "PROJECTS", roles: [], title: "An employee was removed from a project", explicitTitle: "You were removed from a project", body: bodyOf },

  // ----- site instructions -----
  INSTRUCTION_POSTED: { category: "INSTRUCTIONS", roles: ["PM"], projectCrew: true, title: "New site instruction", explicitTitle: "A site instruction was assigned to you", body: bodyOf },
  INSTRUCTION_REVIEWED: { category: "INSTRUCTIONS", roles: [], title: "A site instruction was reviewed", explicitTitle: "Your site instruction update was reviewed", body: bodyOf },
  INSTRUCTION_COMPLETED: { category: "INSTRUCTIONS", roles: ["PM"], title: "A site instruction was completed", body: bodyOf },
  INSTRUCTION_FOR_REVIEW: { category: "INSTRUCTIONS", roles: ["PM"], title: "A site instruction is ready for review", body: bodyOf },
  INSTRUCTION_CANCELLED: { category: "INSTRUCTIONS", roles: [], title: "A site instruction was cancelled", explicitTitle: "A site instruction assigned to you was cancelled", body: bodyOf },

  // ----- time & attendance requests -----
  TIME_ADJUSTMENT_REQUESTED: { category: "ATTENDANCE", roles: ["PM"], title: "A time-adjustment request needs approval", body: () => "Tap to open" },
  TIME_ADJUSTMENT_APPROVED: { category: "ATTENDANCE", roles: [], title: "A time-adjustment request was approved", explicitTitle: "Your time-adjustment request was approved", body: () => "Tap to open" },
  TIME_ADJUSTMENT_HOURS_CHANGED: { category: "ATTENDANCE", roles: [], title: "Hours credited on a time-adjustment request were changed", explicitTitle: "The hours credited on your request were changed", body: () => "Tap to open" },
  TIME_ADJUSTMENT_REJECTED: { category: "ATTENDANCE", roles: [], title: "A time-adjustment request was rejected", explicitTitle: "Your time-adjustment request was rejected", body: () => "Tap to open" },

  // ----- payroll: the admins hear about the run, each person hears about their own payslip -----
  PAYROLL_RUN_GENERATED: { category: "PAYROLL", roles: ["ACCOUNTING"], title: "A payroll draft was generated", body: bodyOf },
  PAYROLL_REVIEW: { category: "PAYROLL", roles: [], title: "A payroll is awaiting approval", body: bodyOf },
  PAYROLL_APPROVED: { category: "PAYROLL", roles: ["ACCOUNTING"], title: "Payroll approved", explicitTitle: "Your payslip is ready", body: bodyOf },
  PAYROLL_PAID: { category: "PAYROLL", roles: ["ACCOUNTING"], title: "Payroll marked as paid", explicitTitle: "Your pay has been released", body: bodyOf },
  PAYROLL_APPROVAL_CANCELLED: { category: "PAYROLL", roles: ["ACCOUNTING"], title: "A payroll approval was cancelled", body: bodyOf },

  // ----- money in, leads, security -----
  PAYMENT_RECORDED: { category: "FINANCE", roles: ["ACCOUNTING"], title: "A client payment was recorded", body: bodyOf },
  PAYMENT_VOIDED: { category: "FINANCE", roles: ["ACCOUNTING"], title: "A client payment was voided", body: bodyOf },
  CASH_SNAPSHOT_RECORDED: { category: "FINANCE", roles: [], title: "A cash snapshot was recorded", body: () => "Tap to open" },
  LEAD_CREATED: { category: "LEADS", roles: [], title: "New lead", body: bodyOf },
  LEAD_STATUS_CHANGED: { category: "LEADS", roles: [], title: "A lead changed status", body: bodyOf },
  QUOTATION_CREATED: { category: "LEADS", roles: [], title: "Quotation created", body: bodyOf },
  QUOTATION_STATUS_CHANGED: { category: "LEADS", roles: [], title: "A quotation changed status", body: bodyOf },
  LOGIN_LOCKED: { category: "SECURITY", roles: [], title: "Repeated failed sign-ins — an account was locked for a while", body: () => "Tap to review" },
  PORTAL_ACCESS_CREATED: { category: "SECURITY", roles: [], title: "A client portal login was created", body: () => "Tap to open" },
};

/** Audit actions built from a status at the call site (e.g. PAYROLL_REVIEW) share the map above; this is the lookup. */
export function eventFor(action: string): EventDef | null {
  return EVENTS[action] ?? null;
}

/**
 * Who should be told about an event. `assignedIds` are the people on the event's project roster. Returns each person once,
 * flagged when the event is directly about them (they get the "your …" wording and the personal link). The person who
 * did it (`actorId`) is never included.
 */
export function selectRecipients(
  def: EventDef,
  ctx: EventCtx,
  users: RecipientUser[],
  assignedIds: Set<string>,
  actorId: string | null
): { userId: string; explicit: boolean }[] {
  const explicitIds = new Set(ctx.explicit ?? []);
  const out = new Map<string, boolean>();
  for (const u of users) {
    if (u.id === actorId) continue;
    const menuOk = hasCategoryMenu(u, def.category);
    const isExplicit = explicitIds.has(u.id);
    let involved = u.role === "OWNER" || isExplicit; // the Owner is involved in everything
    if (!involved && menuOk && def.roles?.includes(u.role)) involved = true;
    if (!involved && def.tokens?.some((t) => TOKEN_TEST[t](u))) involved = true;
    if (!involved && def.projectCrew && menuOk && assignedIds.has(u.id)) involved = true;
    if (involved) out.set(u.id, isExplicit);
  }
  return Array.from(out, ([userId, explicit]) => ({ userId, explicit }));
}

/** Which categories a person is ever told about — what their settings page lists. */
export function eligibleCategories(u: RecipientUser): NotificationCategory[] {
  if (u.role === "OWNER") return ALL_CATEGORIES;
  return ALL_CATEGORIES.filter((c) => {
    if (c === "LEADS" || c === "SECURITY") return false;
    if (c === "FINANCE") return u.role === "ACCOUNTING";
    if (c === "CASH" || c === "PAYROLL") return true; // everyone has their own cash requests and payslips
    return hasCategoryMenu(u, c);
  });
}

/** Whether `now` falls inside someone's quiet hours (Manila time). Handles ranges that cross midnight. */
export function isQuietNow(pref: { quietStart?: number | null; quietEnd?: number | null } | null | undefined, now: Date): boolean {
  if (!pref || pref.quietStart == null || pref.quietEnd == null || pref.quietStart === pref.quietEnd) return false;
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Manila", hour: "2-digit", hour12: false }).format(now)) % 24;
  return pref.quietStart < pref.quietEnd ? hour >= pref.quietStart && hour < pref.quietEnd : hour >= pref.quietStart || hour < pref.quietEnd;
}
