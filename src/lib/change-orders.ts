import { validateConversion } from "@/lib/work-requests";

export type ChangeOrderStatusLike = "POTENTIAL" | "PENDING_CLIENT" | "APPROVED" | "REJECTED" | "WITHDRAWN";

/** Statuses a client may ever see. POTENTIAL and WITHDRAWN are internal and must never reach the portal. */
export const CLIENT_VISIBLE_STATUSES: ChangeOrderStatusLike[] = ["PENDING_CLIENT", "APPROVED", "REJECTED"];

export const CHANGE_ORDER_LABEL: Record<ChangeOrderStatusLike, string> = {
  POTENTIAL: "Potential (internal)",
  PENDING_CLIENT: "Awaiting client",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  WITHDRAWN: "Withdrawn",
};

/** Only a potential change can be sent to the client. */
export const canSendChangeOrder = (s: ChangeOrderStatusLike) => s === "POTENTIAL";

/** The team can pull a change back until the client has decided. */
export const canWithdrawChangeOrder = (s: ChangeOrderStatusLike) => s === "POTENTIAL" || s === "PENDING_CLIENT";

/** Only an approved change order is part of the contract value. */
export const affectsContractValue = (s: ChangeOrderStatusLike) => s === "APPROVED";

/** Sending needs an explicit price and time — a blank is never turned into zero. */
export const validateSend = (input: { costImpact: number | null | undefined; timeImpactDays: number | null | undefined }) => validateConversion(input);

/**
 * How a change order's price reads to the client. A negative amount is a credit
 * back to them (a reduction), never "additional cost" shown with a minus sign.
 */
export function costImpactWording(cost: number): { label: string; amount: number | null } {
  if (cost < 0) return { label: "Credit to you", amount: Math.abs(cost) };
  if (cost === 0) return { label: "No change in price", amount: null };
  return { label: "Additional cost", amount: cost };
}
