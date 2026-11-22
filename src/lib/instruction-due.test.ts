import { describe, expect, it } from "vitest";
import { canAskExtension, daysBetween, dueState, extensionProblem, reminderMessage, reminderRecipients } from "./instruction-due";

const today = "2026-11-22";
const base = { status: "NOT_STARTED", dueKey: "2026-11-21", proposedKey: "2026-11-28", todayKey: today, reason: "Supplier delivery moved to Thursday", pending: false };

describe("instruction due dates", () => {
  it("chases a task due today or past due, until it is marked done", () => {
    expect(dueState("2026-11-21", today, "NOT_STARTED")).toBe("overdue");
    expect(dueState(today, today, "IN_PROGRESS")).toBe("today");
    expect(dueState("2026-11-23", today, "IN_PROGRESS")).toBeNull();
    expect(dueState("2026-11-21", today, "FOR_REVIEW")).toBeNull(); // done, waiting for review
    expect(dueState("2026-11-21", today, "COMPLETED")).toBeNull();
    expect(dueState(null, today, "ON_HOLD")).toBeNull();
    expect(daysBetween("2026-11-21", today)).toBe(1);
  });

  it("words the daily reminder for due today and overdue", () => {
    expect(reminderMessage({ title: "Site visit", taskId: "OOT-2026-0016", where: "Other", dueKey: today, todayKey: today }).title).toBe("Due today: Site visit");
    const late = reminderMessage({ title: "Site visit", taskId: "OOT-2026-0016", where: "Other", dueKey: "2026-11-21", todayKey: today });
    expect(late.title).toBe("Overdue 1 day: Site visit");
    expect(late.body).toContain("target was Nov 21");
    expect(late.body).toContain("request an extension");
  });

  it("checks an extension request", () => {
    expect(extensionProblem(base)).toBeNull();
    expect(extensionProblem({ ...base, status: "COMPLETED" })).toMatch(/closed/);
    expect(extensionProblem({ ...base, dueKey: null })).toMatch(/no target/);
    expect(extensionProblem({ ...base, pending: true })).toMatch(/already waiting/);
    expect(extensionProblem({ ...base, proposedKey: "2026-11-20" })).toMatch(/past/);
    expect(extensionProblem({ ...base, dueKey: "2026-11-25", proposedKey: "2026-11-24" })).toMatch(/after the current target/);
    expect(extensionProblem({ ...base, proposedKey: "2027-02-01" })).toMatch(/at most 60 days/);
    expect(extensionProblem({ ...base, reason: "late" })).toMatch(/why/);
  });

  it("lets the people doing the task ask, not the Owner/PM", () => {
    expect(canAskExtension({ role: "OFFICE", isAssignee: true, broadcast: false })).toBe(true);
    expect(canAskExtension({ role: "FOREMAN", isAssignee: false, broadcast: true })).toBe(true);
    expect(canAskExtension({ role: "OFFICE", isAssignee: false, broadcast: true })).toBe(false);
    expect(canAskExtension({ role: "OWNER", isAssignee: true, broadcast: false })).toBe(false);
    expect(canAskExtension({ role: "PM", isAssignee: true, broadcast: false })).toBe(false);
  });

  it("reminds the assignees, else the project foremen, else the poster", () => {
    expect(reminderRecipients({ assigneeIds: ["joseph", "jomer"], projectForemanIds: ["mark"], postedById: "jacob" })).toEqual(["joseph", "jomer"]);
    expect(reminderRecipients({ assigneeIds: [], projectForemanIds: ["mark"], postedById: "jacob" })).toEqual(["mark"]);
    expect(reminderRecipients({ assigneeIds: [], projectForemanIds: [], postedById: "jacob" })).toEqual(["jacob"]);
  });
});
