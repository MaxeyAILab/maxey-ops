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

  it("only asks people who may actually answer, and asks the Owner to approve a foreman", () => {
    const foremanRfi = rfi({ assigneeId: "fm", assigneeName: "Mark", needsApproval: true, canAnswer: false });
    const foreman = buildActionQueue(input({ viewer: noMoney("fm", "FOREMAN"), rfis: [foremanRfi] }));
    expect(foreman).toHaveLength(0); // can't answer yet, so no "needs your answer" nag
    const owner = buildActionQueue(input({ viewer: noMoney("o", "OWNER"), rfis: [{ ...foremanRfi, canAnswer: true }] }));
    expect(owner.map((i) => i.key)).toContain("rfi-approve-r1");
    const pm = buildActionQueue(input({ rfis: [{ ...foremanRfi, canAnswer: true }] }));
    expect(pm.map((i) => i.key)).not.toContain("rfi-approve-r1"); // approval is the Owner's call
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

describe("buildActionQueue: additional work requests", () => {
  const wr = (over: Record<string, unknown> = {}) => ({ id: "w1", number: "AW-001", title: "Covered walkway", status: "REQUESTED" as const, createdAt: ago(0), ...over });

  it("asks approvers to act on a new client request, escalating after 2 days", () => {
    expect(buildActionQueue(input({ workRequests: [wr()] }))[0].severity).toBe(1);
    expect(buildActionQueue(input({ workRequests: [wr({ createdAt: ago(3) })] }))[0].severity).toBe(2);
  });

  it("stays quiet for converted, declined and withdrawn requests", () => {
    for (const status of ["CONVERTED", "DECLINED", "WITHDRAWN"] as const) {
      expect(buildActionQueue(input({ workRequests: [wr({ status })] }))).toHaveLength(0);
    }
  });

  it("nudges only when a request has been under review for more than 5 days", () => {
    expect(buildActionQueue(input({ workRequests: [wr({ status: "UNDER_REVIEW", createdAt: ago(3) })] }))).toHaveLength(0);
    expect(buildActionQueue(input({ workRequests: [wr({ status: "UNDER_REVIEW", createdAt: ago(8) })] }))).toHaveLength(1);
  });

  it("does not show requests to foremen, and never attaches an amount", () => {
    const foreman = { userId: "f", role: "FOREMAN", showMoney: false, showMargin: false };
    expect(buildActionQueue(input({ viewer: foreman, workRequests: [wr()] }))).toHaveLength(0);
    expect(buildActionQueue(input({ workRequests: [wr()] }))[0].amount).toBeNull();
  });
});

describe("buildActionQueue: billing, retention and potential changes", () => {
  it("flags overdue payments for money viewers, escalating after 30 days, with the unpaid amount", () => {
    const q = buildActionQueue(input({ billing: [{ id: "b1", label: "Progress billing 2", state: "overdue", daysOverdue: 12, outstanding: 80_000 }, { id: "b2", label: "Downpayment", state: "overdue", daysOverdue: 45, outstanding: 20_000 }] }));
    expect(q.map((i) => [i.key, i.severity, i.amount])).toEqual([["bill-b2", 2, 20_000], ["bill-b1", 1, 80_000]]);
  });

  it("hides billing items from roles without money access", () => {
    const noMoney = { userId: "x", role: "PM", showMoney: false, showMargin: false };
    expect(buildActionQueue(input({ viewer: noMoney, billing: [{ id: "b1", label: "x", state: "overdue", daysOverdue: 50, outstanding: 1 }] }))).toHaveLength(0);
  });

  it("ignores paid, billed-but-not-late and fully settled terms", () => {
    const q = buildActionQueue(input({ billing: [
      { id: "a", label: "a", state: "paid", daysOverdue: null, outstanding: 0 },
      { id: "b", label: "b", state: "billed", daysOverdue: null, outstanding: 5 },
      { id: "c", label: "c", state: "overdue", daysOverdue: 9, outstanding: 0 },
    ] }));
    expect(q).toHaveLength(0);
  });

  it("asks accounting to invoice a term that is due but not invoiced", () => {
    const q = buildActionQueue(input({ billing: [{ id: "d", label: "Final billing", state: "due-not-invoiced", daysOverdue: null, outstanding: 9_000 }] }));
    expect(q[0].title).toContain("Ready to invoice");
  });

  it("flags only retention whose release date has passed, never one with no date", () => {
    const q = buildActionQueue(input({ retention: [
      { id: "r1", label: "Retention 10%", outstanding: 50_000, overdue: true, daysUntil: -6 },
      { id: "r2", label: "Retention B", outstanding: 10_000, overdue: false, daysUntil: 20 },
      { id: "r3", label: "Retention C", outstanding: 10_000, overdue: null, daysUntil: null },
    ] }));
    expect(q.map((i) => i.key)).toEqual(["ret-r1"]);
  });

  it("nudges approvers about a potential change left unsent for over two weeks", () => {
    expect(buildActionQueue(input({ potentialChanges: [{ id: "p1", title: "Gate move", createdAt: ago(5) }] }))).toHaveLength(0);
    expect(buildActionQueue(input({ potentialChanges: [{ id: "p1", title: "Gate move", createdAt: ago(20) }] }))[0].key).toBe("pot-p1");
    const foreman = { userId: "f", role: "FOREMAN", showMoney: false, showMargin: false };
    expect(buildActionQueue(input({ viewer: foreman, potentialChanges: [{ id: "p1", title: "Gate move", createdAt: ago(20) }] }))).toHaveLength(0);
  });
});

describe("buildActionQueue: findings and closeout", () => {
  const f = (over: Record<string, unknown> = {}) => ({
    id: "f1", number: "QS-001", title: "Honeycombing on C-4", severity: "MEDIUM" as const, status: "OPEN" as const,
    ownerId: "eng", closureSubmittedById: null as string | null, dueState: "none" as const, createdAt: ago(2), ...over,
  });
  const foreman = (id = "u-foreman") => ({ userId: id, role: "FOREMAN", showMoney: false, showMargin: false });

  it("flags an overdue finding, escalating high and critical ones", () => {
    expect(buildActionQueue(input({ findings: [f({ dueState: "overdue" })] }))[0].severity).toBe(1);
    expect(buildActionQueue(input({ findings: [f({ dueState: "overdue", severity: "HIGH" })] }))[0].severity).toBe(2);
  });

  it("always surfaces an open critical finding to approvers", () => {
    const q = buildActionQueue(input({ findings: [f({ severity: "CRITICAL" })] }));
    expect(q[0]).toMatchObject({ severity: 2, key: "fnd-f1" });
  });

  it("tells the assignee about their own finding only when it is due soon, overdue or high severity", () => {
    expect(buildActionQueue(input({ viewer: foreman("eng"), findings: [f()] }))).toHaveLength(0);
    expect(buildActionQueue(input({ viewer: foreman("eng"), findings: [f({ dueState: "due-soon" })] }))).toHaveLength(1);
    expect(buildActionQueue(input({ viewer: foreman("eng"), findings: [f({ severity: "HIGH" })] }))).toHaveLength(1);
    expect(buildActionQueue(input({ viewer: foreman("other"), findings: [f({ dueState: "overdue" })] }))).toHaveLength(0);
  });

  it("asks a reviewer other than the submitter to review a fix, but lets the Owner always review", () => {
    const ready = f({ status: "READY_FOR_REVIEW" as const, closureSubmittedById: "u-pm" });
    expect(buildActionQueue(input({ findings: [ready] }))).toHaveLength(0); // the PM who submitted it can't review it
    expect(buildActionQueue(input({ viewer: { userId: "pm2", role: "PM", showMoney: true, showMargin: false }, findings: [ready] }))).toHaveLength(1);
    expect(buildActionQueue(input({ viewer: { userId: "o", role: "OWNER", showMoney: true, showMargin: true }, findings: [ready] }))).toHaveLength(1);
  });

  it("ignores closed findings", () => {
    expect(buildActionQueue(input({ findings: [f({ status: "CLOSED" as const, severity: "CRITICAL" })] }))).toHaveLength(0);
  });

  it("nudges closeout at punch-list stage and flags a turnover with open items", () => {
    const base = { total: 8, requiredOpen: 3, openDefectsAndPunch: 0 };
    expect(buildActionQueue(input({ closeout: { projectStatus: "FOR_PUNCHLIST", ...base } }))[0].title).toContain("3 required items");
    expect(buildActionQueue(input({ closeout: { projectStatus: "FOR_PUNCHLIST", total: 0, requiredOpen: 0, openDefectsAndPunch: 0 } }))[0].title).toContain("Start the closeout checklist");
    expect(buildActionQueue(input({ closeout: { projectStatus: "TURNED_OVER", ...base } }))[0].severity).toBe(2);
    expect(buildActionQueue(input({ closeout: { projectStatus: "ONGOING_CONSTRUCTION", ...base } }))).toHaveLength(0);
    expect(buildActionQueue(input({ closeout: { projectStatus: "FOR_PUNCHLIST", total: 8, requiredOpen: 0, openDefectsAndPunch: 0 } }))).toHaveLength(0);
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
