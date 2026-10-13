export type WorkRequestStatusLike = "REQUESTED" | "UNDER_REVIEW" | "CONVERTED" | "DECLINED" | "WITHDRAWN";

/** A client may have this many requests waiting on the team per project — a guard against flooding, not a business rule. */
export const MAX_OPEN_REQUESTS_PER_PROJECT = 10;

export const formatWorkRequestNumber = (n: number) => `AW-${String(n).padStart(3, "0")}`;

export const isOpenWorkRequest = (s: WorkRequestStatusLike) => s === "REQUESTED" || s === "UNDER_REVIEW";

interface Actor {
  id: string;
  role: string;
  clientId?: string | null;
}

/** Only the Owner and PM assess, convert or decline a request. */
export const canReviewWorkRequest = (role: string) => role === "OWNER" || role === "PM";

/** Any user of the project's own client account may submit a request on it. */
export function canSubmitWorkRequest(actor: Actor, projectClientId: string): boolean {
  return actor.role === "CLIENT" && !!actor.clientId && actor.clientId === projectClientId;
}

/** A client can withdraw their own client's request, but only while the team hasn't acted on it. */
export function canWithdrawWorkRequest(
  request: { status: WorkRequestStatusLike },
  actor: Actor,
  projectClientId: string
): boolean {
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
      return "Sent to you as a change order";
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
 */
export function validateConversion(input: { costImpact: number | null | undefined; timeImpactDays: number | null | undefined }): string | null {
  if (input.costImpact == null || Number.isNaN(input.costImpact)) return "Enter the cost impact before sending this to the client";
  if (input.timeImpactDays == null || Number.isNaN(input.timeImpactDays)) return "Enter the time impact (days) before sending this to the client";
  if (input.costImpact < 0) return "Cost impact can't be negative";
  if (!Number.isInteger(input.timeImpactDays) || input.timeImpactDays < 0) return "Time impact must be a whole number of days, 0 or more";
  return null;
}
