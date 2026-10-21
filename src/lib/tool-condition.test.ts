import { describe, expect, it } from "vitest";
import { TOOL_CONDITIONS, TOOL_CONDITION_LABEL, blocksCheckout, conditionAfterMovement, isToolCondition } from "./tool-condition";

describe("tool and equipment condition", () => {
  it("has the four states people asked for, in plain words", () => {
    expect(TOOL_CONDITIONS.map((c) => TOOL_CONDITION_LABEL[c])).toEqual(["Working", "For repair", "Not working", "For disposal"]);
  });

  it("recognises only those values", () => {
    for (const c of TOOL_CONDITIONS) expect(isToolCondition(c)).toBe(true);
    for (const v of ["working", "BROKEN", "", null, undefined, 3]) expect(isToolCondition(v)).toBe(false);
  });

  it("only a working tool can be sent out to a site", () => {
    expect(blocksCheckout("WORKING")).toBe(false);
    for (const c of ["FOR_REPAIR", "NOT_WORKING", "FOR_DISPOSAL"] as const) expect(blocksCheckout(c), c).toBe(true);
  });

  it("flagging under repair marks it For repair, and 'repaired' marks it Working", () => {
    expect(conditionAfterMovement("MARK_UNDER_REPAIR", "WORKING")).toBe("FOR_REPAIR");
    expect(conditionAfterMovement("MARK_AVAILABLE", "FOR_REPAIR")).toBe("WORKING");
    expect(conditionAfterMovement("MARK_AVAILABLE", "NOT_WORKING")).toBe("WORKING");
  });

  it("other movements leave the condition alone", () => {
    for (const t of ["CHECKOUT_TO_SITE", "RETURN_TO_WAREHOUSE", "TRANSFER_SITE_TO_SITE", "MARK_LOST"]) {
      expect(conditionAfterMovement(t, "FOR_DISPOSAL"), t).toBe("FOR_DISPOSAL");
      expect(conditionAfterMovement(t, "WORKING"), t).toBe("WORKING");
    }
  });
});
