/**
 * How a tool or piece of equipment is doing: working, for repair, not working, or for disposal. This is separate from where it
 * is (in the warehouse, on a site…). Pure rules, shared by the page, the API and the tests.
 */
export const TOOL_CONDITIONS = ["WORKING", "FOR_REPAIR", "NOT_WORKING", "FOR_DISPOSAL"] as const;
export type ToolConditionValue = (typeof TOOL_CONDITIONS)[number];

export const TOOL_CONDITION_LABEL: Record<ToolConditionValue, string> = {
  WORKING: "Working",
  FOR_REPAIR: "For repair",
  NOT_WORKING: "Not working",
  FOR_DISPOSAL: "For disposal",
};

export const isToolCondition = (v: unknown): v is ToolConditionValue => typeof v === "string" && (TOOL_CONDITIONS as readonly string[]).includes(v);

/** A tool that isn't in working order is not sent out to a site. */
export const blocksCheckout = (c: ToolConditionValue): boolean => c !== "WORKING";

/**
 * Flagging a tool "under repair" marks it For repair; marking it available again (repaired) marks it Working. Other movements
 * leave the condition alone.
 */
export function conditionAfterMovement(type: string, current: ToolConditionValue): ToolConditionValue {
  if (type === "MARK_UNDER_REPAIR") return "FOR_REPAIR";
  if (type === "MARK_AVAILABLE") return "WORKING";
  return current;
}
