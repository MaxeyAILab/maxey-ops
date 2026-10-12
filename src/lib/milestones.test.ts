import { describe, expect, it } from "vitest";
import { computeMilestoneHealth, manilaToday, parseDateOnly, upcomingMilestones, type MilestoneDates } from "./milestones";
import { canCancelRfi, canCloseRfi, canRaiseRfi, canRespondToRfi, formatRfiNumber, rfiDueState } from "./rfi";

// Noon Manila on 2026-10-12 (04:00 UTC)
const now = new Date("2026-10-12T04:00:00Z");
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const ms = (over: Partial<MilestoneDates>): MilestoneDates => ({
  status: "IN_PROGRESS",
  baselineFinish: d("2026-11-01"),
  forecastFinish: d("2026-11-01"),
  actualFinish: null,
  ...over,
});

describe("manilaToday / parseDateOnly", () => {
  it("uses the Manila calendar day, not UTC", () => {
    // 2026-10-11 20:00 UTC is already Oct 12 in Manila
    expect(manilaToday(new Date("2026-10-11T20:00:00Z"))).toBe(manilaToday(new Date("2026-10-12T04:00:00Z")));
  });

  it("parses a valid date and rejects impossible ones", () => {
    expect(parseDateOnly("2026-10-12")?.toISOString()).toBe("2026-10-12T00:00:00.000Z");
    expect(parseDateOnly("")).toBeNull();
    expect(() => parseDateOnly("2026-02-30")).toThrow();
    expect(() => parseDateOnly("12/10/2026")).toThrow();
  });
});

describe("computeMilestoneHealth", () => {
  it("is on track when forecast equals or beats baseline", () => {
    expect(computeMilestoneHealth(ms({}), now).health).toBe("on-track");
    expect(computeMilestoneHealth(ms({ forecastFinish: d("2026-10-25") }), now).varianceDays).toBe(-7);
  });

  it("flags watch for a small slip and late beyond the default 7 days", () => {
    expect(computeMilestoneHealth(ms({ forecastFinish: d("2026-11-05") }), now)).toMatchObject({ health: "watch", varianceDays: 4 });
    expect(computeMilestoneHealth(ms({ forecastFinish: d("2026-11-08") }), now).health).toBe("watch"); // exactly 7 days
    expect(computeMilestoneHealth(ms({ forecastFinish: d("2026-11-09") }), now).health).toBe("late"); // 8 days
  });

  it("treats more than the threshold as late and honours a custom threshold", () => {
    expect(computeMilestoneHealth(ms({ forecastFinish: d("2026-11-10") }), now).health).toBe("late");
    expect(computeMilestoneHealth(ms({ forecastFinish: d("2026-11-10") }), now, { lateDays: 14 }).health).toBe("watch");
  });

  it("is overdue once the current finish date has passed and it is not complete", () => {
    const r = computeMilestoneHealth(ms({ baselineFinish: d("2026-10-01"), forecastFinish: d("2026-10-10") }), now);
    expect(r.health).toBe("overdue");
    expect(r.overdueDays).toBe(2);
  });

  it("is not overdue on its due day", () => {
    expect(computeMilestoneHealth(ms({ forecastFinish: d("2026-10-12"), baselineFinish: d("2026-10-12") }), now).health).toBe("on-track");
  });

  it("never reports on-track when there is no baseline or no dates", () => {
    expect(computeMilestoneHealth(ms({ baselineFinish: null }), now).health).toBe("no-baseline");
    expect(computeMilestoneHealth(ms({ baselineFinish: null, forecastFinish: null }), now).health).toBe("no-dates");
  });

  it("falls back to the baseline when there is no forecast", () => {
    expect(computeMilestoneHealth(ms({ forecastFinish: null, baselineFinish: d("2026-10-05") }), now).health).toBe("overdue");
  });

  it("measures a completed milestone against its baseline", () => {
    expect(computeMilestoneHealth(ms({ status: "COMPLETED", actualFinish: d("2026-10-30") }), now).health).toBe("complete");
    expect(computeMilestoneHealth(ms({ status: "COMPLETED", actualFinish: d("2026-11-20") }), now)).toMatchObject({ health: "complete-late", varianceDays: 19 });
    expect(computeMilestoneHealth(ms({ status: "COMPLETED", actualFinish: null }), now).health).toBe("complete");
  });

  it("surfaces blocked milestones", () => {
    expect(computeMilestoneHealth(ms({ status: "BLOCKED" }), now).health).toBe("blocked");
  });
});

describe("upcomingMilestones", () => {
  it("lists overdue and soon-due open milestones soonest first, skipping complete and far-off ones", () => {
    const list = [
      { id: "far", ...ms({ forecastFinish: d("2026-12-30"), baselineFinish: d("2026-12-30") }) },
      { id: "soon", ...ms({ forecastFinish: d("2026-10-20"), baselineFinish: d("2026-10-20") }) },
      { id: "late", ...ms({ forecastFinish: d("2026-10-05"), baselineFinish: d("2026-10-05") }) },
      { id: "done", ...ms({ status: "COMPLETED", forecastFinish: d("2026-10-14") }) },
      { id: "nodates", ...ms({ forecastFinish: null, baselineFinish: null }) },
    ];
    expect(upcomingMilestones(list, now, 30).map((m) => m.id)).toEqual(["late", "soon"]);
  });
});

describe("RFI rules", () => {
  it("formats project-scoped numbers", () => {
    expect(formatRfiNumber(7)).toBe("RFI-007");
  });

  it("computes due state only for open RFIs", () => {
    expect(rfiDueState({ status: "OPEN", dueDate: d("2026-10-10") }, now)).toBe("overdue");
    expect(rfiDueState({ status: "OPEN", dueDate: d("2026-10-12") }, now)).toBe("due-soon");
    expect(rfiDueState({ status: "OPEN", dueDate: d("2026-10-30") }, now)).toBe("ok");
    expect(rfiDueState({ status: "OPEN", dueDate: null }, now)).toBe("none");
    expect(rfiDueState({ status: "ANSWERED", dueDate: d("2026-10-01") }, now)).toBe("none");
  });

  it("lets foremen raise internal RFIs only", () => {
    expect(canRaiseRfi("FOREMAN", "INTERNAL")).toBe(true);
    expect(canRaiseRfi("FOREMAN", "CLIENT")).toBe(false);
    expect(canRaiseRfi("PM", "CLIENT")).toBe(true);
    expect(canRaiseRfi("CLIENT", "INTERNAL")).toBe(false);
    expect(canRaiseRfi("ACCOUNTING", "INTERNAL")).toBe(false);
  });

  const internal = { addressedTo: "INTERNAL" as const, assigneeId: "eng", status: "OPEN" as const };
  const toClient = { addressedTo: "CLIENT" as const, assigneeId: null, status: "OPEN" as const };

  it("restricts who can answer an internal RFI", () => {
    expect(canRespondToRfi(internal, { id: "pm", role: "PM" }, "c1").ok).toBe(true);
    expect(canRespondToRfi(internal, { id: "eng", role: "OFFICE" }, "c1").ok).toBe(true); // the assignee
    expect(canRespondToRfi(internal, { id: "other", role: "FOREMAN" }, "c1").ok).toBe(false);
    expect(canRespondToRfi(internal, { id: "x", role: "CLIENT", clientId: "c1" }, "c1").ok).toBe(false);
  });

  it("only lets the project's own client answer a client RFI, and flags Owner answers as on-behalf", () => {
    expect(canRespondToRfi(toClient, { id: "u", role: "CLIENT", clientId: "c1" }, "c1")).toEqual({ ok: true, onBehalfOfClient: false });
    expect(canRespondToRfi(toClient, { id: "u", role: "CLIENT", clientId: "c2" }, "c1").ok).toBe(false); // another client's project
    expect(canRespondToRfi(toClient, { id: "o", role: "OWNER" }, "c1")).toEqual({ ok: true, onBehalfOfClient: true });
    expect(canRespondToRfi(toClient, { id: "p", role: "PM" }, "c1").ok).toBe(false);
  });

  it("does not allow answering a non-open RFI", () => {
    expect(canRespondToRfi({ ...internal, status: "ANSWERED" }, { id: "pm", role: "PM" }, "c1").ok).toBe(false);
  });

  it("closes only answered RFIs, by the raiser or a PM/Owner", () => {
    const answered = { status: "ANSWERED" as const, raisedById: "fm" };
    expect(canCloseRfi(answered, { id: "fm", role: "FOREMAN" })).toBe(true);
    expect(canCloseRfi(answered, { id: "other", role: "FOREMAN" })).toBe(false);
    expect(canCloseRfi(answered, { id: "pm", role: "PM" })).toBe(true);
    expect(canCloseRfi({ ...answered, status: "OPEN" }, { id: "pm", role: "PM" })).toBe(false);
    expect(canCloseRfi(answered, { id: "c", role: "CLIENT", clientId: "c1" })).toBe(false);
  });

  it("cancels only open RFIs", () => {
    expect(canCancelRfi({ status: "OPEN", raisedById: "fm" }, { id: "fm", role: "FOREMAN" })).toBe(true);
    expect(canCancelRfi({ status: "ANSWERED", raisedById: "fm" }, { id: "fm", role: "FOREMAN" })).toBe(false);
  });
});
