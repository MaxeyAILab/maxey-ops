import { describe, expect, it } from "vitest";
import {
  canCloseFinding,
  canRaiseFinding,
  canReopenFinding,
  canSendBackFinding,
  canViewFinding,
  canWorkFinding,
  closureProblems,
  findingCounts,
  findingDueState,
  formatFindingNumber,
  isRestrictedType,
} from "./findings";
import { closeoutProgress, DEFAULT_CLOSEOUT_TEMPLATE } from "./closeout";
import { currentRevision, nextRevisionLabel, parseDocumentDataUrl, validateDocumentLink } from "./documents";
import { csvCell, redactDiff, summarizeDiff, toCsv } from "./history";

const now = new Date("2026-10-12T04:00:00Z");
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("findings: visibility and permissions", () => {
  it("formats numbers and restricts incidents only", () => {
    expect(formatFindingNumber(3)).toBe("QS-003");
    expect(isRestrictedType("INCIDENT")).toBe(true);
    for (const t of ["DEFECT", "PUNCH_ITEM", "INSPECTION", "SAFETY_OBSERVATION"] as const) expect(isRestrictedType(t)).toBe(false);
  });

  it("shows a restricted finding only to Owner, PM, the raiser and the assignee", () => {
    const f = { restricted: true, raisedById: "fm", ownerId: "eng" };
    expect(canViewFinding(f, { id: "o", role: "OWNER" })).toBe(true);
    expect(canViewFinding(f, { id: "p", role: "PM" })).toBe(true);
    expect(canViewFinding(f, { id: "fm", role: "FOREMAN" })).toBe(true);
    expect(canViewFinding(f, { id: "eng", role: "OFFICE" })).toBe(true);
    expect(canViewFinding(f, { id: "other", role: "FOREMAN" })).toBe(false);
    expect(canViewFinding(f, { id: "a", role: "ACCOUNTING" })).toBe(false);
    expect(canViewFinding({ ...f, restricted: false }, { id: "other", role: "FOREMAN" })).toBe(true);
  });

  it("lets only Owner, PM and foremen raise findings", () => {
    for (const r of ["OWNER", "PM", "FOREMAN"]) expect(canRaiseFinding(r)).toBe(true);
    for (const r of ["ACCOUNTING", "PURCHASING", "OFFICE", "DRIVER", "CLIENT"]) expect(canRaiseFinding(r)).toBe(false);
  });

  it("lets the assignee or an approver work a finding", () => {
    expect(canWorkFinding({ ownerId: "eng" }, { id: "eng", role: "OFFICE" })).toBe(true);
    expect(canWorkFinding({ ownerId: "eng" }, { id: "pm", role: "PM" })).toBe(true);
    expect(canWorkFinding({ ownerId: "eng" }, { id: "x", role: "FOREMAN" })).toBe(false);
    expect(canWorkFinding({ ownerId: null }, { id: "x", role: "FOREMAN" })).toBe(false);
  });
});

describe("findings: closure", () => {
  it("requires a note, and a photo for high and critical findings", () => {
    expect(closureProblems({ severity: "LOW" }, { note: "ok", photoCount: 0 })).toMatch(/Describe/);
    expect(closureProblems({ severity: "LOW" }, { note: "Patched and repainted", photoCount: 0 })).toBeNull();
    expect(closureProblems({ severity: "HIGH" }, { note: "Patched and repainted", photoCount: 0 })).toMatch(/photo/);
    expect(closureProblems({ severity: "CRITICAL" }, { note: "Guard rail installed", photoCount: 1 })).toBeNull();
  });

  it("needs a different reviewer than the person who submitted the closure (Owner excepted)", () => {
    const f = { status: "READY_FOR_REVIEW" as const, closureSubmittedById: "pm1" };
    expect(canCloseFinding(f, { id: "pm1", role: "PM" })).toBe(false);
    expect(canCloseFinding(f, { id: "pm2", role: "PM" })).toBe(true);
    expect(canCloseFinding(f, { id: "pm1", role: "OWNER" })).toBe(true);
    expect(canCloseFinding(f, { id: "fm", role: "FOREMAN" })).toBe(false);
    expect(canCloseFinding({ ...f, status: "OPEN" as never }, { id: "o", role: "OWNER" })).toBe(false);
  });

  it("lets approvers send a finding back, and only the Owner reopen a closed one", () => {
    expect(canSendBackFinding({ status: "READY_FOR_REVIEW" }, { id: "p", role: "PM" })).toBe(true);
    expect(canSendBackFinding({ status: "OPEN" }, { id: "p", role: "PM" })).toBe(false);
    expect(canReopenFinding({ status: "CLOSED" }, { id: "o", role: "OWNER" })).toBe(true);
    expect(canReopenFinding({ status: "CLOSED" }, { id: "p", role: "PM" })).toBe(false);
  });
});

describe("findings: due state and counts", () => {
  it("is only overdue while unclosed and with a real due date", () => {
    expect(findingDueState({ status: "OPEN", dueDate: d("2026-10-10") }, now)).toBe("overdue");
    expect(findingDueState({ status: "OPEN", dueDate: d("2026-10-12") }, now)).toBe("due-soon");
    expect(findingDueState({ status: "OPEN", dueDate: d("2026-11-12") }, now)).toBe("ok");
    expect(findingDueState({ status: "OPEN", dueDate: null }, now)).toBe("none");
    expect(findingDueState({ status: "CLOSED", dueDate: d("2026-01-01") }, now)).toBe("none");
  });

  it("reports plain counts, never a rate", () => {
    const c = findingCounts(
      [
        { status: "OPEN", severity: "CRITICAL", dueDate: d("2026-10-01"), closedAt: null },
        { status: "IN_PROGRESS", severity: "HIGH", dueDate: null, closedAt: null },
        { status: "READY_FOR_REVIEW", severity: "LOW", dueDate: d("2026-12-01"), closedAt: null },
        { status: "CLOSED", severity: "HIGH", dueDate: null, closedAt: new Date("2026-10-05T00:00:00Z") },
        { status: "CLOSED", severity: "LOW", dueDate: null, closedAt: new Date("2026-06-05T00:00:00Z") },
      ],
      now
    );
    expect(c).toEqual({ open: 3, openBySeverity: { CRITICAL: 1, HIGH: 1, MEDIUM: 0, LOW: 1 }, overdue: 1, readyForReview: 1, closedLast30Days: 1 });
  });
});

describe("closeoutProgress", () => {
  it("is never ready with no checklist", () => {
    const p = closeoutProgress([], 0);
    expect(p.ready).toBe(false);
    expect(p.blockers[0]).toMatch(/No closeout checklist/);
    expect(p.pct).toBe(0);
  });

  it("counts required items only for the percentage", () => {
    const p = closeoutProgress([{ required: true, done: true }, { required: true, done: false }, { required: false, done: false }], 0);
    expect(p).toMatchObject({ total: 3, done: 1, requiredTotal: 2, requiredDone: 1, pct: 50, ready: false });
  });

  it("is blocked by open defects or punch items even when the checklist is complete", () => {
    const items = [{ required: true, done: true }];
    expect(closeoutProgress(items, 2)).toMatchObject({ ready: false, blockers: ["2 defect or punch items still open"] });
    expect(closeoutProgress(items, 0).ready).toBe(true);
  });

  it("ships a template with required items and at least one optional one", () => {
    expect(DEFAULT_CLOSEOUT_TEMPLATE.length).toBeGreaterThanOrEqual(8);
    expect(DEFAULT_CLOSEOUT_TEMPLATE.some((i) => !i.required)).toBe(true);
  });
});

describe("documents", () => {
  it("accepts only plain https links", () => {
    expect(validateDocumentLink("https://drive.google.com/file/d/abc/view")).toBeNull();
    expect(validateDocumentLink("http://example.com/a.pdf")).toMatch(/https/);
    expect(validateDocumentLink("javascript:alert(1)")).not.toBeNull();
    expect(validateDocumentLink("data:text/html;base64,AAAA")).not.toBeNull();
    expect(validateDocumentLink("https://user:pass@example.com/a.pdf")).toMatch(/username/);
    expect(validateDocumentLink("not a url")).not.toBeNull();
    expect(validateDocumentLink("https://localhost/a")).not.toBeNull();
  });

  it("validates small uploads by type and size", () => {
    expect(parseDocumentDataUrl("data:application/pdf;base64,JVBERi0xLjQ=")).toMatchObject({ ok: true, mime: "application/pdf" });
    expect(parseDocumentDataUrl("data:text/html;base64,PGh0bWw+")).toMatchObject({ ok: false });
    expect(parseDocumentDataUrl("data:application/x-msdownload;base64,AAAA")).toMatchObject({ ok: false });
    const big = "data:application/pdf;base64," + "A".repeat(5 * 1024 * 1024);
    expect(parseDocumentDataUrl(big)).toMatchObject({ ok: false });
    expect(parseDocumentDataUrl("garbage")).toMatchObject({ ok: false });
  });

  it("suggests the next revision label", () => {
    expect(nextRevisionLabel([])).toBe("A");
    expect(nextRevisionLabel(["A"])).toBe("B");
    expect(nextRevisionLabel(["A", "B", "C"])).toBe("D");
    expect(nextRevisionLabel(["Rev 1", "Rev 2"])).toBe("Rev 3");
    expect(nextRevisionLabel(["Issued for construction"])).toBe("Rev 2");
  });

  it("picks the newest current revision", () => {
    const revs = [
      { revision: "A", current: false, createdAt: d("2026-09-01") },
      { revision: "B", current: true, createdAt: d("2026-10-01") },
    ];
    expect(currentRevision(revs)?.revision).toBe("B");
    expect(currentRevision([{ revision: "A", current: false, createdAt: d("2026-09-01") }])).toBeNull();
  });
});

describe("history export", () => {
  it("removes financial values at any depth, and leaves everything else", () => {
    const diff = { project: "Warehouse", costImpact: 45000, from: { contractBefore: 1, title: "Gate", estimatedCost: 5 }, list: [{ amount: 9, note: "ok" }], status: "APPROVED" };
    expect(redactDiff(diff)).toEqual({ project: "Warehouse", from: { title: "Gate" }, list: [{ note: "ok" }], status: "APPROVED" });
  });

  it("summarises a diff, hiding money unless allowed", () => {
    const diff = { title: "Walkway", costImpact: 185000, days: 6 };
    expect(summarizeDiff(diff, true)).toContain("costImpact=185000");
    expect(summarizeDiff(diff, false)).not.toContain("185000");
    expect(summarizeDiff(null, true)).toBe("");
  });

  it("escapes CSV and neutralises spreadsheet formulas", () => {
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("=HYPERLINK(\"http://evil\")")).toBe('"\'=HYPERLINK(""http://evil"")"');
    expect(csvCell("+1+1")).toBe("'+1+1");
    expect(csvCell("-2")).toBe("'-2");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell(null)).toBe("");
    expect(toCsv(["a", "b"], [[1, "x,y"]])).toBe('a,b\r\n1,"x,y"\r\n');
  });
});
