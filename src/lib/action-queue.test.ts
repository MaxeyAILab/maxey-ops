import { describe, expect, it } from "vitest";
import { buildActionQueue, type ActionInput } from "./action-queue";
import { mergeActivity } from "./project-activity";

const now = new Date("2026-10-12T00:00:00Z");
const ago = (days: number) => new Date(now.getTime() - days * 86_400_000);

function input(over: Partial<ActionInput> = {}): ActionInput {
  return {
    now,
    viewer: { userId: "u-pm", role: "PM", showMoney: true, showMargin: false },
    progress: [],
    changeOrders: [],
    requisitions: [],
    dueTerms: [],
    instructions: [],
    schedule: { state: "on-plan", varianceDays: null },
    weightsTotal: 100,
    costState: "ok",
    isOngoing: true,
    ...over,
  };
}

const submitted = (id: string, daysOld: number, by = "u-foreman") => ({
  id,
  workItem: "Footing",
  pct: 50,
  status: "SUBMITTED" as const,
  submittedById: by,
  submittedByName: "Foreman Joe",
  createdAt: ago(daysOld),
  reviewNote: null,
});

describe("buildActionQueue", () => {
  it("asks approvers to review submitted progress, escalating after 2 days", () => {
    const q = buildActionQueue(input({ progress: [submitted("a", 1), submitted("b", 5)] }));
    expect(q.map((i) => [i.key, i.severity])).toEqual([["prog-b", 2], ["prog-a", 1]]);
  });

  it("does not ask a foreman to review progress", () => {
    const q = buildActionQueue(input({ viewer: { userId: "u-foreman", role: "FOREMAN", showMoney: false, showMargin: false }, progress: [submitted("a", 5)] }));
    expect(q).toHaveLength(0);
  });

  it("shows a queried entry to its submitter but not to other foremen", () => {
    const queried = { ...submitted("q", 1), status: "QUERIED" as const, reviewNote: "Photo is blurry" };
    const mine = buildActionQueue(input({ viewer: { userId: "u-foreman", role: "FOREMAN", showMoney: false, showMargin: false }, progress: [queried] }));
    const other = buildActionQueue(input({ viewer: { userId: "u-other", role: "FOREMAN", showMoney: false, showMargin: false }, progress: [queried] }));
    expect(mine).toHaveLength(1);
    expect(mine[0].detail).toContain("Photo is blurry");
    expect(other).toHaveLength(0);
  });

  it("flags stale client change orders and hides the amount from non-money roles", () => {
    const co = { id: "c1", title: "Extra culverts", status: "PENDING_CLIENT", costImpact: 250_000, createdAt: ago(20) };
    const pm = buildActionQueue(input({ changeOrders: [co] }));
    expect(pm[0].severity).toBe(2);
    expect(pm[0].amount).toBe(250_000);
    const noMoney = buildActionQueue(input({ viewer: { userId: "x", role: "PM", showMoney: false, showMargin: false }, changeOrders: [co] }));
    expect(noMoney[0].amount).toBeNull();
  });

  it("ignores approved and rejected change orders", () => {
    const co = { id: "c1", title: "Done", status: "APPROVED", costImpact: 1, createdAt: ago(20) };
    expect(buildActionQueue(input({ changeOrders: [co] }))).toHaveLength(0);
  });

  it("only shows requisitions that are urgent or old", () => {
    const base = { status: "SUBMITTED", submittedByName: "X", estimatedCost: 1000 };
    const q = buildActionQueue(
      input({
        requisitions: [
          { id: "r1", urgency: "NORMAL", submittedAt: ago(1), ...base },
          { id: "r2", urgency: "NORMAL", submittedAt: ago(6), ...base },
          { id: "r3", urgency: "CRITICAL", submittedAt: ago(0), ...base },
        ],
      })
    );
    expect(q.map((i) => i.key)).toEqual(["req-r3", "req-r2"]);
  });

  it("shows billing milestones only to money viewers", () => {
    const due = [{ id: "t1", label: "Progress billing 2", outstanding: 2_000_000 }];
    expect(buildActionQueue(input({ dueTerms: due }))).toHaveLength(1);
    expect(buildActionQueue(input({ viewer: { userId: "x", role: "PM", showMoney: false, showMargin: false }, dueTerms: due }))).toHaveLength(0);
  });

  it("flags overdue instructions and skips completed ones", () => {
    const q = buildActionQueue(
      input({
        instructions: [
          { id: "i1", label: "Pour slab", dueDate: ago(3), status: "IN_PROGRESS", priority: "HIGH" },
          { id: "i2", label: "Done thing", dueDate: ago(3), status: "COMPLETED", priority: "HIGH" },
          { id: "i3", label: "Future", dueDate: ago(-3), status: "IN_PROGRESS", priority: "NORMAL" },
        ],
      })
    );
    expect(q.map((i) => i.key)).toEqual(["instr-i1"]);
    expect(q[0].severity).toBe(2);
  });

  it("raises a data-gap item only for margin viewers", () => {
    const owner = buildActionQueue(input({ viewer: { userId: "o", role: "OWNER", showMoney: true, showMargin: true }, costState: "no-cost" }));
    const pm = buildActionQueue(input({ costState: "no-cost" }));
    expect(owner.some((i) => i.key === "cost")).toBe(true);
    expect(pm.some((i) => i.key === "cost")).toBe(false);
  });

  it("flags weights that do not total 100, but not projects with no weighted items", () => {
    expect(buildActionQueue(input({ weightsTotal: 110 }))[0].severity).toBe(2);
    expect(buildActionQueue(input({ weightsTotal: 80 }))[0].severity).toBe(1);
    expect(buildActionQueue(input({ weightsTotal: null }))).toHaveLength(0);
    expect(buildActionQueue(input({ weightsTotal: 100 }))).toHaveLength(0);
  });
});

describe("buildActionQueue: RFIs and milestones", () => {
  const noMoney = (userId: string, role: string) => ({ userId, role, showMoney: false, showMargin: false });
  const rfi = (over: Record<string, unknown> = {}) => ({
    id: "r1",
    number: "RFI-001",
    subject: "Rebar spacing",
    status: "OPEN" as const,
    addressedTo: "INTERNAL" as const,
    assigneeId: "eng",
    assigneeName: "Engr. Lim",
    raisedById: "u-foreman",
    dueState: "overdue" as const,
    createdAt: ago(2),
    ...over,
  });

  it("asks the assignee and approvers to answer an overdue internal RFI, but not an unrelated foreman", () => {
    const eng = buildActionQueue(input({ viewer: noMoney("eng", "OFFICE"), rfis: [rfi()] }));
    const pm = buildActionQueue(input({ rfis: [rfi()] }));
    const other = buildActionQueue(input({ viewer: noMoney("x", "FOREMAN"), rfis: [rfi()] }));
    expect(eng).toHaveLength(1);
    expect(pm[0].severity).toBe(2);
    expect(other).toHaveLength(0);
  });

  it("stays quiet about a fresh RFI that is not due soon", () => {
    expect(buildActionQueue(input({ rfis: [rfi({ dueState: "ok", createdAt: ago(0) })] }))).toHaveLength(0);
  });

  it("shows a stalled client RFI to approvers only", () => {
    const stalled = rfi({ addressedTo: "CLIENT", assigneeId: null, assigneeName: null, dueState: "none", createdAt: ago(8) });
    expect(buildActionQueue(input({ rfis: [stalled] }))[0].responsible).toBe("Client");
    expect(buildActionQueue(input({ viewer: noMoney("u-foreman", "FOREMAN"), rfis: [stalled] }))).toHaveLength(0);
  });

  it("asks whoever raised an answered RFI to close it", () => {
    const answered = rfi({ status: "ANSWERED" as const });
    const raiser = buildActionQueue(input({ viewer: noMoney("u-foreman", "FOREMAN"), rfis: [answered] }));
    expect(raiser[0].title).toContain("review and close");
  });

  it("raises overdue, blocked, slipping and due-soon milestones for approvers", () => {
    const m = (health: string, extra: Record<string, unknown> = {}) => ({ id: health, title: health, health: health as never, varianceDays: null, overdueDays: null, responsibleId: null, dueInDays: null, ...extra });
    const q = buildActionQueue(
      input({
        milestones: [
          m("overdue", { overdueDays: 4 }),
          m("blocked"),
          m("late", { varianceDays: 10 }),
          m("watch", { varianceDays: 3 }),
          m("on-track", { dueInDays: 5 }),
          m("on-track", { id: "far", dueInDays: 40 }),
          m("complete"),
        ],
      })
    );
    expect(q.map((i) => i.key).sort()).toEqual(["ms-blocked", "ms-late", "ms-on-track", "ms-overdue", "ms-watch"]);
    expect(q.find((i) => i.key === "ms-watch")!.severity).toBe(1);
  });

  it("shows a milestone to its responsible person but not to other foremen", () => {
    const m = { id: "a", title: "Slab", health: "overdue" as const, varianceDays: null, overdueDays: 2, responsibleId: "u-foreman", dueInDays: null };
    expect(buildActionQueue(input({ viewer: noMoney("u-foreman", "FOREMAN"), milestones: [m] }))).toHaveLength(1);
    expect(buildActionQueue(input({ viewer: noMoney("other", "FOREMAN"), milestones: [m] }))).toHaveLength(0);
  });
});

describe("mergeActivity", () => {
  const live = [{ key: "a", type: "report" as const, at: ago(1), title: "DCR-002", detail: "", actor: "Joe", href: "#", refId: "r2" }];
  const logs = [
    { id: "l1", refId: "r2", type: "DAILY_REPORT", summary: "DCR-002 log", actorName: "Joe", createdAt: ago(1), href: "#" },
    { id: "l2", refId: "r1", type: "DAILY_REPORT", summary: "DCR-001 log", actorName: "Joe", createdAt: ago(9), href: "#" },
  ];

  it("hides a log line while its live record exists, keeps it once the record is gone", () => {
    const merged = mergeActivity(live, logs, 10);
    expect(merged.map((m) => m.key)).toEqual(["a", "log-l2"]);
    expect(merged[1].archived).toBe(true);
  });

  it("sorts newest first and respects the limit", () => {
    expect(mergeActivity(live, logs, 1)).toHaveLength(1);
  });
});
