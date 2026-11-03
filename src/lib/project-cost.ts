import type { ProjectStatus } from "@prisma/client";

/**
 * The project cost (contract value) can be revised by the Owner while the project is still being set up — Site Survey and
 * Mobilization. Once construction starts (On-going Construction, and everything after it) the contract value is FINAL: it can only
 * move through a change order the client approves, never by editing it. The moment a project reaches one of the locking statuses
 * the lock is remembered (costLockedAt), so moving the status back — e.g. to On-hold or Mobilization — never opens it again.
 */
export const COST_LOCKING_STATUSES: ProjectStatus[] = ["ONGOING_CONSTRUCTION", "FOR_PUNCHLIST", "TURNED_OVER"];

export const locksCost = (status: ProjectStatus): boolean => COST_LOCKING_STATUSES.includes(status);

export const COST_LOCKED_MESSAGE =
  "The contract value is final — construction has started. Additional work has to be requested by the client or put on a change order the client approves.";

export interface CostLockState {
  status: ProjectStatus;
  costLockedAt: Date | string | null;
}

/** Whether the contract value can still be edited, and if not, why. */
export function contractLock(p: CostLockState): { locked: boolean; message: string | null } {
  const locked = !!p.costLockedAt || locksCost(p.status);
  return { locked, message: locked ? COST_LOCKED_MESSAGE : null };
}
