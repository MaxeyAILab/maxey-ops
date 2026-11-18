import { describe, expect, it } from "vitest";
import { canRequestReturn, statusAfterReturn } from "./tool-return";

describe("returning a tool to the warehouse", () => {
  it("can be asked for a tool on site or under repair at a project", () => {
    expect(canRequestReturn("ON_SITE", "rdf")).toBe(true);
    expect(canRequestReturn("UNDER_REPAIR", "rdf")).toBe(true);
  });

  it("can't be asked for a tool already in the warehouse, under repair there, or lost", () => {
    expect(canRequestReturn("IN_WAREHOUSE", null)).toBe(false);
    expect(canRequestReturn("UNDER_REPAIR", null)).toBe(false);
    expect(canRequestReturn("LOST", "rdf")).toBe(false);
  });

  it("keeps an under-repair tool under repair once it is back", () => {
    expect(statusAfterReturn("UNDER_REPAIR")).toBe("UNDER_REPAIR");
    expect(statusAfterReturn("ON_SITE")).toBe("IN_WAREHOUSE");
  });
});
