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
}

const isApprover = (role: string) => role === "OWNER" || role === "PM";

/** Who may raise an RFI. A foreman can only raise internal ones; sending a question to the client is a PM/Owner call. */
export function canRaiseRfi(role: string, addressedTo: RfiAddresseeLike): boolean {
  if (addressedTo === "CLIENT") return isApprover(role);
  return isApprover(role) || role === "FOREMAN";
}

/**
 * Who may answer. Internal RFIs: PM/Owner or the assigned staff member.
 * Client RFIs: a user of the project's own client account (or the Owner,
 * who can record an answer on the client's behalf — it is audited as such).
 */
export function canRespondToRfi(
  rfi: { addressedTo: RfiAddresseeLike; assigneeId: string | null; status: RfiStatusLike },
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
  if (isApprover(actor.role) || (rfi.assigneeId != null && rfi.assigneeId === actor.id && actor.role !== "CLIENT")) {
    return { ok: true, onBehalfOfClient: false };
  }
  return { ok: false, reason: "Only the PM, the Owner or the assignee can answer this RFI" };
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
