import { dayIndex, manilaToday } from "@/lib/milestones";

export type WorkRequestStatusLike = "REQUESTED" | "UNDER_REVIEW" | "CONVERTED" | "DECLINED" | "WITHDRAWN";

/** A client may have this many requests waiting on the team per project — a guard against flooding, not a business rule. */
export const MAX_OPEN_REQUESTS_PER_PROJECT = 10;

export const formatWorkRequestNumber = (n: number) => `CR-${String(n).padStart(3, "0")}`;

export type WorkRequestKindLike = "ADDITION" | "CHANGE" | "REDUCTION";
export type WorkRequestSourceLike = "PORTAL" | "PHONE" | "MESSAGE" | "EMAIL" | "MEETING" | "SITE";

export const KIND_LABEL: Record<WorkRequestKindLike, string> = {
  ADDITION: "New work",
  CHANGE: "Change to existing work",
  REDUCTION: "Reduction",
};

/** Plain-language hint under each option in the request form. */
export const KIND_HINT: Record<WorkRequestKindLike, string> = {
  ADDITION: "Something new that isn't in the contract yet",
  CHANGE: "Different materials, size, finish or layout than planned",
  REDUCTION: "Take something out — we'll price it as a credit to you",
};

export const SOURCE_LABEL: Record<WorkRequestSourceLike, string> = {
  PORTAL: "Client portal",
  PHONE: "Phone call",
  MESSAGE: "Text / chat message",
  EMAIL: "Email",
  MEETING: "Meeting",
  SITE: "Said on site",
};

/** Ways staff can record an instruction the client gave outside the portal. */
export const STAFF_SOURCES: WorkRequestSourceLike[] = ["PHONE", "MESSAGE", "EMAIL", "MEETING", "SITE"];

export const isOpenWorkRequest = (s: WorkRequestStatusLike) => s === "REQUESTED" || s === "UNDER_REVIEW";

interface Actor {
  id: string;
  role: string;
  clientId?: string | null;
}

/** Only the Owner and PM assess, convert or decline a request. */
export const canReviewWorkRequest = (role: string) => role === "OWNER" || role === "PM";

/**
 * Who may write down an instruction the client gave outside the portal. A foreman
 * hears many of them on site, so they can record one — but only the Owner/PM price it.
 */
export const canRecordClientInstruction = (role: string) => role === "OWNER" || role === "PM" || role === "FOREMAN";

/** The day an instruction was given can't be in the future or more than a year back. */
export function validateInstructedOn(date: Date | null | undefined, now: Date): string | null {
  if (!date) return null;
  const given = dayIndex(date);
  const today = manilaToday(now);
  if (given == null) return "Enter a valid date";
  if (given > today) return "The date the instruction was given can't be in the future";
  if (today - given > 365) return "That date is more than a year ago — check it";
  return null;
}

/** Any user of the project's own client account may submit a request on it. */
export function canSubmitWorkRequest(actor: Actor, projectClientId: string): boolean {
  return actor.role === "CLIENT" && !!actor.clientId && actor.clientId === projectClientId;
}

/** A client can withdraw their own client's request, but only while the team hasn't acted on it. */
export function canWithdrawWorkRequest(
  request: { status: WorkRequestStatusLike; source?: WorkRequestSourceLike },
  actor: Actor,
  projectClientId: string
): boolean {
  // An instruction the team wrote down from a call, message or meeting is a record, not the client's to take back.
  if (request.source && request.source !== "PORTAL") return false;
  return canSubmitWorkRequest(actor, projectClientId) && isOpenWorkRequest(request.status);
}

/** What the client reads — plain language, no internal assessment. */
export function clientStatusLabel(status: WorkRequestStatusLike): string {
  switch (status) {
    case "REQUESTED":
      return "Submitted";
    case "UNDER_REVIEW":
      return "Being reviewed";
    case "CONVERTED":
      return "Quotation sent to you";
    case "DECLINED":
      return "Not going ahead";
    case "WITHDRAWN":
      return "Withdrawn";
  }
}

/**
 * Converting a request into a change order needs a real estimate — a missing
 * cost or time is never silently turned into zero. Returns an error message,
 * or null when the numbers are acceptable. A cost of exactly 0 is allowed
 * (e.g. work absorbed at no charge) because it has to be typed explicitly.
 * The sign has to match the kind: new work can't be a credit, a reduction
 * can't add cost, and a change to existing work can go either way.
 */
export function validateConversion(
  input: { costImpact: number | null | undefined; timeImpactDays: number | null | undefined },
  kind: WorkRequestKindLike = "ADDITION"
): string | null {
  if (input.costImpact == null || Number.isNaN(input.costImpact)) return "Enter the cost impact before sending this to the client";
  if (input.timeImpactDays == null || Number.isNaN(input.timeImpactDays)) return "Enter the time impact (days) before sending this to the client";
  if (kind === "ADDITION" && input.costImpact < 0) return "Cost impact can't be negative for new work — use “Reduction” or “Change” for a credit";
  if (kind === "REDUCTION" && input.costImpact > 0) return "A reduction is a credit to the client, so its amount can't add cost";
  if (!Number.isInteger(input.timeImpactDays) || input.timeImpactDays < 0) return "Time impact must be a whole number of days, 0 or more";
  return null;
}

export interface RequestStage {
  /** How far along the four-step path it is: 1 Submitted, 2 Being priced, 3 Quotation sent, 4 Decision. */
  step: 1 | 2 | 3 | 4;
  label: string;
  tone: "pending" | "progress" | "action" | "good" | "closed";
}

export const REQUEST_STEPS = ["Submitted", "Being priced", "Quotation sent", "Decision"] as const;

/**
 * One line that tells the whole story of an instruction — the request and the
 * change order it became — so nobody has to cross-read two panels. For the
 * client, a change order the team pulled back reads as "being reviewed" because
 * withdrawn and potential change orders are internal states they never see.
 */
export function requestStage(
  wr: { status: WorkRequestStatusLike },
  co: { status: string } | null,
  audience: "client" | "staff"
): RequestStage {
  const staff = audience === "staff";
  switch (wr.status) {
    case "WITHDRAWN":
      return { step: 1, label: staff ? "Withdrawn by the client" : "Withdrawn", tone: "closed" };
    case "DECLINED":
      return { step: 2, label: staff ? "Declined" : "Not going ahead", tone: "closed" };
    case "REQUESTED":
      return { step: 1, label: staff ? "New — needs review" : "Submitted", tone: "pending" };
    case "UNDER_REVIEW":
      return { step: 2, label: "Being priced", tone: "progress" };
    case "CONVERTED":
      if (!co || co.status === "PENDING_CLIENT") {
        return { step: 3, label: staff ? "Quotation sent — awaiting the client" : "Quotation sent — awaiting your approval", tone: "action" };
      }
      if (co.status === "APPROVED") return { step: 4, label: "Approved", tone: "good" };
      if (co.status === "REJECTED") return { step: 4, label: staff ? "Quotation rejected by the client" : "You declined the quotation", tone: "closed" };
      // WITHDRAWN / POTENTIAL
      return staff ? { step: 3, label: "Quotation withdrawn", tone: "closed" } : { step: 2, label: "Being reviewed", tone: "progress" };
  }
}
