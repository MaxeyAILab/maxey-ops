/**
 * Two-step delivery verification. The driver verifies the count against the PO; the person who received the delivery on site (or in
 * the warehouse / office) then confirms they really received it. Only then is the delivery fully verified and the PO and
 * requisition move on. Deliveries from before this rule (needsConfirmation = false) count as fully verified. Pure rules, shared by
 * the API, the Deliveries page and the tests.
 */

interface ConfirmState {
  needsConfirmation: boolean;
  confirmedAt?: Date | string | null;
  disputedAt?: Date | string | null;
}

/** Verified by the driver but not yet confirmed by the receiver. */
export const isAwaitingConfirmation = (d: ConfirmState): boolean => d.needsConfirmation && !d.confirmedAt;

export type DeliveryStage = "AWAITING" | "DISPUTED" | "CONFIRMED";

export function deliveryStage(d: ConfirmState): DeliveryStage {
  if (!isAwaitingConfirmation(d)) return "CONFIRMED";
  return d.disputedAt ? "DISPUTED" : "AWAITING";
}

/**
 * Who can confirm a waiting delivery: the person named as the receiver; the Owner for anyone. When the receiver is not in the app,
 * the PM and Purchasing can confirm for them. A delivery that was already confirmed (or never needed it) cannot be confirmed again.
 */
export function canConfirmDelivery(user: { id: string; role: string }, d: ConfirmState & { receiverId: string | null }): boolean {
  if (!isAwaitingConfirmation(d)) return false;
  if (user.role === "OWNER") return true;
  if (d.receiverId) return user.id === d.receiverId;
  return user.role === "PM" || user.role === "PURCHASING";
}

/** The driver's and the receiver's names are both required before a delivery can be verified. Returns what is missing, or null. */
export function missingNames(input: { driverName?: string | null; receiverId?: string | null; recipientName?: string | null }): string | null {
  if (!input.driverName || input.driverName.trim().length < 2) return "Enter the driver's name";
  if (!input.receiverId && (!input.recipientName || input.recipientName.trim().length < 2)) return "Enter who is receiving the delivery";
  return null;
}
