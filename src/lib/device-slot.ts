/**
 * One signed-in device per account — except the Owner, who may be signed in on two: one phone and one computer. The device type
 * comes from the browser's user-agent when signing in. A second phone (or second computer) still replaces the first, so the
 * Owner never has more than one of each.
 */
export type DeviceSlot = "desktop" | "phone";

export const deviceSlot = (userAgent: string | null | undefined): DeviceSlot => (/Mobi|Android|iPhone|iPod|iPad/i.test(userAgent ?? "") ? "phone" : "desktop");

/** The user column that holds the session id for a device: the usual one, or (Owner on a phone) the phone's own. */
export type SessionColumn = "currentSessionId" | "mobileSessionId";

export const allowsTwoDevices = (role: string): boolean => role === "OWNER";

export const sessionColumn = (role: string, slot: DeviceSlot): SessionColumn => (allowsTwoDevices(role) && slot === "phone" ? "mobileSessionId" : "currentSessionId");

/** Is this session still the one the account is holding for its device? (A later sign-in on that device replaces it.) */
export function sessionIsCurrent(user: { role: string; currentSessionId: string | null; mobileSessionId: string | null }, sessionId: string | null | undefined): boolean {
  if (!sessionId) return false;
  if (user.currentSessionId && user.currentSessionId === sessionId) return true;
  return allowsTwoDevices(user.role) && !!user.mobileSessionId && user.mobileSessionId === sessionId;
}
