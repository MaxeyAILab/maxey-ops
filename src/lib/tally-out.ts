/**
 * Pure rules for tally-out forms — materials leaving a warehouse for a project. No database here; shared by the API, the page
 * and the tests.
 *
 * The steps, in order: the form is filed (PENDING) → the Owner, or a person the Owner allowed, approves it (APPROVED) → the driver
 * verifies what was loaded (VERIFIED) → the person receiving it on site confirms (DELIVERED). Only the last step moves any stock.
 * From the moment it is filed the quantities are RESERVED: they still sit in the warehouse, but nobody else can promise them.
 */

export type TallyStatus = "PENDING" | "APPROVED" | "VERIFIED" | "DELIVERED" | "REJECTED" | "CANCELLED";

export interface TallyLine {
  itemId: string;
  name: string;
  unit: string;
  qty: number;
}

export const OPEN_STATUSES: TallyStatus[] = ["PENDING", "APPROVED", "VERIFIED"];
export const isOpen = (s: string): boolean => (OPEN_STATUSES as string[]).includes(s);

export const STATUS_LABEL: Record<TallyStatus, string> = {
  PENDING: "Waiting for approval",
  APPROVED: "Approved — waiting for the driver",
  VERIFIED: "On the way — waiting for the receiver",
  DELIVERED: "Delivered",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The same item entered twice becomes one line; empty and zero lines are dropped. */
export function mergeLines(lines: { itemId: string; name: string; unit: string; qty: number }[]): TallyLine[] {
  const out = new Map<string, TallyLine>();
  for (const l of lines) {
    const qty = round2(Number(l.qty));
    if (!(qty > 0)) continue;
    const have = out.get(l.itemId);
    if (have) have.qty = round2(have.qty + qty);
    else out.set(l.itemId, { itemId: l.itemId, name: l.name, unit: l.unit, qty });
  }
  return [...out.values()];
}

/** How much of each item is promised to forms that have not been delivered yet (optionally leaving one form out). */
export function reservedByItem(open: { id: string; items: { itemId: string; qty: number }[] }[], exceptId?: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of open) {
    if (t.id === exceptId) continue;
    for (const l of t.items) out.set(l.itemId, round2((out.get(l.itemId) ?? 0) + Number(l.qty)));
  }
  return out;
}

/** What can still be promised: what is in the warehouse minus what is reserved. Never below zero. */
export const availableToPromise = (onHand: number, reserved: number): number => Math.max(0, round2(onHand - reserved));

/** Lines that ask for more than can be promised. */
export function shortLines(lines: TallyLine[], onHand: Map<string, number>, reserved: Map<string, number>): { line: TallyLine; available: number }[] {
  const out: { line: TallyLine; available: number }[] = [];
  for (const l of lines) {
    const available = availableToPromise(onHand.get(l.itemId) ?? 0, reserved.get(l.itemId) ?? 0);
    if (l.qty > available + 1e-9) out.push({ line: l, available });
  }
  return out;
}

export interface UserLike {
  id: string;
  role: string;
  department?: string | null;
  canApproveTallyOut?: boolean | null;
}

/** The Owner, and anyone the Owner switched on (People page — Joseph Villamor). */
export const canApproveTallyOut = (u: UserLike): boolean => u.role === "OWNER" || !!u.canApproveTallyOut;

/** Nobody approves their own form, except the Owner. */
export const canDecideOwnTallyOut = (u: UserLike): boolean => u.role === "OWNER";

/** Who may verify what was loaded: whoever may verify a delivery (drivers, foremen, engineers, PM, Owner). */
export const canVerifyTallyOut = (u: UserLike): boolean => ["FOREMAN", "PM", "OWNER", "DRIVER"].includes(u.role) || u.department === "ENGINEER" || u.department === "DRIVER";

/** Who may confirm it was received: the named receiver; the Owner for anyone; the PM and Purchasing when the receiver is not in the app. */
export function canConfirmTallyOut(u: UserLike, t: { receiverId: string | null; status: string }): boolean {
  if (t.status !== "VERIFIED") return false;
  if (u.role === "OWNER") return true;
  if (t.receiverId) return u.id === t.receiverId;
  return u.role === "PM" || u.role === "PURCHASING";
}

export interface DriverRow {
  itemId: string;
  countedQty: number;
  ok: boolean;
  remarks?: string | null;
}
export interface ReceiverRow {
  itemId: string;
  receivedQty: number;
  remarks?: string | null;
}

/** What the driver counted can be less than the form but never more. */
export function checkDriverRows(lines: TallyLine[], rows: DriverRow[]): string | null {
  const byId = new Map(rows.map((r) => [r.itemId, r]));
  for (const l of lines) {
    const r = byId.get(l.itemId);
    if (!r) return `Count ${l.name} too`;
    if (r.countedQty < 0) return `${l.name}: the count cannot be negative`;
    if (r.countedQty > l.qty + 1e-9) return `${l.name}: you counted more (${r.countedQty}) than the form allows (${l.qty})`;
  }
  for (const r of rows) if (!lines.some((l) => l.itemId === r.itemId)) return "A counted item is not on this form";
  return null;
}

/** What the receiver got can be less than what the driver counted but never more. */
export function checkReceiverRows(counted: Map<string, number>, rows: ReceiverRow[]): string | null {
  const byId = new Map(rows.map((r) => [r.itemId, r]));
  for (const [itemId, c] of counted) {
    const r = byId.get(itemId);
    if (!r) return "Enter what you received for every item";
    if (r.receivedQty < 0) return "A quantity cannot be negative";
    if (r.receivedQty > c + 1e-9) return `You received more (${r.receivedQty}) than the driver counted (${c})`;
  }
  for (const r of rows) if (!counted.has(r.itemId)) return "A received item is not on this form";
  return null;
}

/** What actually moves: the quantity the receiver confirmed for each line (lines with nothing received move nothing). */
export function movedQuantities(rows: ReceiverRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    const q = round2(Number(r.receivedQty));
    if (q > 0) out.set(r.itemId, q);
  }
  return out;
}

/** One line per item that did not arrive as the form said — for the audit log and the people who need to look. */
export function shortfallText(lines: TallyLine[], received: Map<string, number>): string[] {
  return lines.flatMap((l) => {
    const got = received.get(l.itemId) ?? 0;
    return got + 1e-9 < l.qty ? [`${l.name}: form ${l.qty}, received ${got}`] : [];
  });
}
