import { manilaToday, dayIndex } from "@/lib/milestones";

export type RfiStatusLike = "OPEN" | "ANSWERED" | "CLOSED" | "CANCELLED";
export type RfiAddresseeLike = "INTERNAL" | "CLIENT";

export const formatRfiNumber = (n: number) => `RFI-${String(n).padStart(3, "0")}`;

export type RfiDueState = "none" | "overdue" | "due-soon" | "ok";

/** Only an open RFI can be overdue; "due soon" means within `soonDays`. */
export function rfiDueState(
  r: { status: RfiStatusLike; dueDate: Date | null },
  now: Date,
  soonDays = 3
): RfiDueState {
  if (r.status !== "OPEN" || !r.dueDate) return "none";
  const today = manilaToday(now);
  const due = dayIndex(r.dueDate)!;
  if (due < today) return "overdue";
  return due - today <= soonDays ? "due-soon" : "ok";
}

interface Actor {
  id: string;
  role: string;
  clientId?: string | null;
  department?: string | null;
}

const isApprover = (role: string) => role === "OWNER" || role === "PM";

/** Project Engineers and Project Architects are the staff whose department is Engineer / Architect. */
export const isDesignProfessional = (a: { role: string; department?: string | null }) =>
  a.role !== "CLIENT" && (a.department === "ENGINEER" || a.department === "ARCHITECT");

/**
 * Who can be given an internal RFI to answer: the people who may answer it
 * (Owner, PM, Project Engineer, Project Architect) plus foremen, who can only
 * answer once the Owner has approved them for that RFI.
 */
export const canBeRfiAssignee = (a: { role: string; department?: string | null }) =>
  isApprover(a.role) || a.role === "FOREMAN" || isDesignProfessional(a);

/** Who may raise an RFI. A foreman can only raise internal ones; sending a question to the client is a PM/Owner call. */
export function canRaiseRfi(role: string, addressedTo: RfiAddresseeLike): boolean {
  if (addressedTo === "CLIENT") return isApprover(role);
  return isApprover(role) || role === "FOREMAN";
}

/**
 * Who may answer.
 * Internal RFIs: the Owner, a PM, or a Project Engineer / Project Architect.
 * A foreman can answer only the RFI assigned to them and only after the Owner
 * has approved that (`answerApprovedAt`); nobody else on staff can answer.
 * Client RFIs: a user of the project's own client account (or the Owner,
 * who can record an answer on the client's behalf — it is audited as such).
 */
export function canRespondToRfi(
  rfi: { addressedTo: RfiAddresseeLike; assigneeId: string | null; status: RfiStatusLike; answerApprovedAt?: Date | null },
  actor: Actor,
  projectClientId: string
): { ok: true; onBehalfOfClient: boolean } | { ok: false; reason: string } {
  if (rfi.status !== "OPEN") return { ok: false, reason: `This RFI is ${rfi.status.toLowerCase()}` };
  if (rfi.addressedTo === "CLIENT") {
    if (actor.role === "CLIENT") {
      return actor.clientId && actor.clientId === projectClientId
        ? { ok: true, onBehalfOfClient: false }
        : { ok: false, reason: "Not your project" };
    }
    if (actor.role === "OWNER") return { ok: true, onBehalfOfClient: true };
    return { ok: false, reason: "Only the client (or the Owner on their behalf) can answer this RFI" };
  }
  if (isApprover(actor.role) || isDesignProfessional(actor)) return { ok: true, onBehalfOfClient: false };
  if (actor.role === "FOREMAN" && rfi.assigneeId != null && rfi.assigneeId === actor.id) {
    return rfi.answerApprovedAt
      ? { ok: true, onBehalfOfClient: false }
      : { ok: false, reason: "The Owner has to approve you answering this RFI first" };
  }
  return { ok: false, reason: "Only the Owner, PM, Project Engineer or Project Architect can answer this RFI (a foreman needs the Owner's approval)" };
}

/** Whether the Owner still has to approve an assigned foreman before they can answer. */
export function needsAnswerApproval(
  rfi: { addressedTo: RfiAddresseeLike; status: RfiStatusLike; assigneeId: string | null; answerApprovedAt?: Date | null },
  assigneeRole: string | null | undefined
): boolean {
  return rfi.status === "OPEN" && rfi.addressedTo === "INTERNAL" && rfi.assigneeId != null && assigneeRole === "FOREMAN" && !rfi.answerApprovedAt;
}

/** Closing needs an answer first; the person who raised it or a PM/Owner confirms it's resolved. */
export function canCloseRfi(
  rfi: { status: RfiStatusLike; raisedById: string },
  actor: Actor
): boolean {
  return rfi.status === "ANSWERED" && actor.role !== "CLIENT" && (isApprover(actor.role) || rfi.raisedById === actor.id);
}

export function canCancelRfi(rfi: { status: RfiStatusLike; raisedById: string }, actor: Actor): boolean {
  return rfi.status === "OPEN" && actor.role !== "CLIENT" && (isApprover(actor.role) || rfi.raisedById === actor.id);
}

export function canManageRfi(actor: Actor): boolean {
  return isApprover(actor.role);
}
