/**
 * Sending a tool back to its warehouse from a project. A tool that is on site can be returned, and so can one that was marked
 * under repair while at a project (owner's request 2026-11-18): it comes back to the warehouse still under repair, so it keeps
 * its "Under repair" status and "For repair" condition until someone marks it available (repaired).
 */
export type ToolLocationStatus = "IN_WAREHOUSE" | "ON_SITE" | "UNDER_REPAIR" | "LOST";

/** Can a return-to-warehouse be asked for a tool in this state? */
export const canRequestReturn = (status: ToolLocationStatus, currentProjectId: string | null): boolean =>
  !!currentProjectId && (status === "ON_SITE" || status === "UNDER_REPAIR");

/** Its status once back in the warehouse: an under-repair tool stays under repair, anything else is simply in the warehouse. */
export const statusAfterReturn = (status: ToolLocationStatus): "IN_WAREHOUSE" | "UNDER_REPAIR" =>
  status === "UNDER_REPAIR" ? "UNDER_REPAIR" : "IN_WAREHOUSE";
