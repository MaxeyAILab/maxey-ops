import { describe, expect, it } from "vitest";
import { canAddDocument, canInputProgress, canLogPotentialChange, isProjectManagerRole } from "./project-input";

describe("project input", () => {
  const engineer = { role: "OFFICE", projectInput: true };
  const office = { role: "OFFICE" };
  it("an office account without the switch can do nothing here", () => {
    expect(canInputProgress(office)).toBe(false);
    expect(canAddDocument(office)).toBe(false);
    expect(canLogPotentialChange(office)).toBe(false);
  });
  it("the switch opens progress, daily reports, documents and potential changes", () => {
    expect(canInputProgress(engineer)).toBe(true);
    expect(canAddDocument(engineer)).toBe(true);
    expect(canLogPotentialChange(engineer)).toBe(true);
  });
  it("but does not make them a project manager", () => {
    expect(isProjectManagerRole(engineer)).toBe(false);
    expect(isProjectManagerRole({ role: "PM" })).toBe(true);
    expect(isProjectManagerRole({ role: "OWNER" })).toBe(true);
  });
  it("owner, PM keep everything; foreman keeps progress only", () => {
    for (const role of ["OWNER", "PM"]) {
      expect(canInputProgress({ role }) && canAddDocument({ role }) && canLogPotentialChange({ role })).toBe(true);
    }
    expect(canInputProgress({ role: "FOREMAN" })).toBe(true);
    expect(canAddDocument({ role: "FOREMAN" })).toBe(false);
    expect(canLogPotentialChange({ role: "FOREMAN" })).toBe(false);
  });
});
