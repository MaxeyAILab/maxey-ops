/**
 * Per-person "same authority as the Owner" switches (People page), one for the Inventory tab and one for Cash Expense. The Owner
 * always has both; the Owner can give either to someone else (Joseph Villamor has both). Pure, so routes, pages and tests share it.
 */
export interface OwnerPowerPerson {
  role: string;
  ownerInventory?: boolean | null;
  ownerCash?: boolean | null;
}

/** Inventory: logs return/transfer movements that take effect at once, decides any request (their own and limited people's), prices a logged movement, deletes stock items and tools. */
export const hasInventoryOwnerPowers = (u: OwnerPowerPerson): boolean => u.role === "OWNER" || !!u.ownerInventory;

/** Cash Expense: everything the Owner does — approves and releases petty cash, runs the fund, approves cash advances, edits reports, deletes records. */
export const hasCashOwnerPowers = (u: OwnerPowerPerson): boolean => u.role === "OWNER" || !!u.ownerCash;
