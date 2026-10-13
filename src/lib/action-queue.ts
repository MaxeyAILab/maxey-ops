import type { ReviewStatus } from "@/lib/progress";
import type { ScheduleState } from "@/lib/schedule";
import type { CostState } from "@/lib/forecast";
import type { MilestoneHealth } from "@/lib/milestones";
import type { RfiAddresseeLike, RfiDueState, RfiStatusLike } from "@/lib/rfi";
import type { WorkRequestStatusLike } from "@/lib/work-requests";
import type { BillingState } from "@/lib/billing";
import type { FindingDueState, FindingSeverityLike, FindingStatusLike } from "@/lib/findings";

const DAY = 86_400_000;
const ageDays = (d: Date, now: Date) => Math.max(0, Math.floor((now.getTime() - d.getTime()) / DAY));

export interface ActionItem {
  key: string;
  severity: 1 | 2; // 1 = due soon / watch, 2 = overdue / critical
  title: string;
  detail: string;
  responsible: string;
  when: string;
  href: string;
  amount: number | null; // only ever set for viewers allowed to see money
}

export interface ActionInput {
  now: Date;
  viewer: { userId: string; role: string; showMoney: boolean; showMargin: boolean };
  progress: {
    id: string;
    workItem: string | null;
    pct: number;
    status: ReviewStatus;
    submittedById: string;
    submittedByName: string;
    createdAt: Date;
    reviewNote: string | null;
  }[];
  changeOrders: { id: string; title: string; status: string; costImpact: number; createdAt: Date }[];
  requisitions: {
    id: string;
    status: string;
    urgency: string;
    submittedByName: string;
    submittedAt: Date;
    estimatedCost: number | null;
  }[];
  dueTerms: { id: string; label: string; outstanding: number }[];
  instructions: { id: string; label: string; dueDate: Date | null; status: string; priority: string }[];
  schedule: { state: ScheduleState; varianceDays: number | null };
  weightsTotal: number | null; // null = no weighted work items yet
  costState: CostState;
  isOngoing: boolean;
  rfis?: {
    id: string;
    number: string; // RFI-003
    subject: string;
    status: RfiStatusLike;
    addressedTo: RfiAddresseeLike;
    assigneeId: string | null;
    assigneeName: string | null;
    /** Whether this viewer is allowed to answer it (Owner, PM, project engineer/architect, or an approved foreman). */
    canAnswer?: boolean;
    /** Assigned to a foreman the Owner has not approved yet. */
    needsApproval?: boolean;
    raisedById: string;
    dueState: RfiDueState;
    createdAt: Date;
  }[];
  /** Already filtered to findings this viewer is allowed to see (restricted incidents removed). */
  findings?: {
    id: string;
    number: string;
    title: string;
    severity: FindingSeverityLike;
    status: FindingStatusLike;
    ownerId: string | null;
    closureSubmittedById: string | null;
    dueState: FindingDueState;
    createdAt: Date;
  }[];
  closeout?: { projectStatus: string; total: number; requiredOpen: number; openDefectsAndPunch: number };
  billing?: { id: string; label: string; state: BillingState; daysOverdue: number | null; outstanding: number }[];
  retention?: { id: string; label: string; outstanding: number; overdue: boolean | null; daysUntil: number | null }[];
  potentialChanges?: { id: string; title: string; createdAt: Date }[];
  workRequests?: { id: string; number: string; title: string; status: WorkRequestStatusLike; createdAt: Date }[];
  milestones?: {
    id: string;
    title: string;
    health: MilestoneHealth;
    varianceDays: number | null;
    overdueDays: number | null;
    responsibleId: string | null;
    dueInDays: number | null; // days until the current finish date; null if none
  }[];
}

/**
 * The "Needs your action" list for one project, filtered to what this viewer
 * can act on and allowed to see. Money amounts are only attached for viewers
 * with money access; items a role can't act on are left out rather than shown
 * greyed. Sorted by severity, then by how long it has been waiting.
 */
export function buildActionQueue(input: ActionInput): ActionItem[] {
  const { now, viewer } = input;
  const isApprover = viewer.role === "OWNER" || viewer.role === "PM";
  const items: (ActionItem & { age: number })[] = [];
  const amount = (n: number | null) => (viewer.showMoney ? n : null);

  for (const e of input.progress) {
    const age = ageDays(e.createdAt, now);
    const label = e.workItem ?? "Progress entry";
    if (e.status === "SUBMITTED" && isApprover) {
      items.push({
        key: `prog-${e.id}`,
        severity: age > 2 ? 2 : 1,
        title: `Review progress: ${label} (${e.pct.toFixed(0)}%)`,
        detail: `Submitted by ${e.submittedByName}`,
        responsible: "PM / Owner",
        when: age === 0 ? "Submitted today" : `Waiting ${age}d`,
        href: "#progress",
        amount: null,
        age,
      });
    }
    if (e.status === "QUERIED" && (isApprover || e.submittedById === viewer.userId)) {
      items.push({
        key: `query-${e.id}`,
        severity: age > 2 ? 2 : 1,
        title: `Progress queried: ${label}`,
        detail: e.reviewNote ? `“${e.reviewNote}”` : "Edit the entry and resubmit",
        responsible: e.submittedByName,
        when: `Queried · entry ${age}d old`,
        href: "#progress",
        amount: null,
        age,
      });
    }
  }

  if (isApprover) {
    for (const co of input.changeOrders) {
      if (co.status !== "PENDING_CLIENT") continue;
      const age = ageDays(co.createdAt, now);
      items.push({
        key: `co-${co.id}`,
        severity: age > 14 ? 2 : 1,
        title: `Change order awaiting client: ${co.title}`,
        detail: "Follow up with the client if it has stalled",
        responsible: "Client",
        when: `Waiting ${age}d`,
        href: "#changes",
        amount: amount(co.costImpact),
        age,
      });
    }
  }

  if (isApprover || viewer.role === "PURCHASING" || viewer.role === "ACCOUNTING") {
    for (const r of input.requisitions) {
      if (r.status !== "SUBMITTED" && r.status !== "UNDER_REVIEW") continue;
      const age = ageDays(r.submittedAt, now);
      if (r.urgency !== "CRITICAL" && r.urgency !== "HIGH" && age <= 3) continue;
      items.push({
        key: `req-${r.id}`,
        severity: r.urgency === "CRITICAL" ? 2 : 1,
        title: `Requisition awaiting approval (${r.urgency.toLowerCase()})`,
        detail: `Submitted by ${r.submittedByName}`,
        responsible: "Owner",
        when: `Waiting ${age}d`,
        href: `/requisitions/${r.id}`,
        amount: amount(r.estimatedCost),
        age,
      });
    }
  }

  if (viewer.showMoney) {
    for (const t of input.dueTerms) {
      if (t.outstanding <= 0) continue;
      items.push({
        key: `due-${t.id}`,
        severity: 1,
        title: `Billing milestone due: ${t.label}`,
        detail: "Marked Due and not yet fully paid",
        responsible: "Accounting",
        when: "Due",
        href: "#commercial",
        amount: t.outstanding,
        age: 0,
      });
    }
  }

  for (const i of input.instructions) {
    if (!i.dueDate || i.dueDate >= now || i.status === "COMPLETED" || i.status === "CANCELLED") continue;
    const age = ageDays(i.dueDate, now);
    items.push({
      key: `instr-${i.id}`,
      severity: i.priority === "CRITICAL" || i.priority === "HIGH" ? 2 : 1,
      title: `Site instruction past due: ${i.label}`,
      detail: "Open instruction not yet completed",
      responsible: "Assignees",
      when: `${age}d overdue`,
      href: "/instructions",
      amount: null,
      age,
    });
  }

  if (input.schedule.state === "overdue" || input.schedule.state === "late") {
    items.push({
      key: "schedule",
      severity: 2,
      title: input.schedule.state === "overdue" ? "Past the target finish date" : "Behind plan on time vs work done",
      detail:
        input.schedule.state === "overdue" && input.schedule.varianceDays != null
          ? `${input.schedule.varianceDays} days past target`
          : "Review the schedule recovery plan",
      responsible: "PM",
      when: "Schedule",
      href: "#overview",
      amount: null,
      age: 0,
    });
  }

  if (isApprover && input.weightsTotal != null && Math.abs(input.weightsTotal - 100) > 0.01) {
    items.push({
      key: "weights",
      severity: input.weightsTotal > 100 ? 2 : 1,
      title: `Work-item weights total ${input.weightsTotal.toFixed(0)}%`,
      detail:
        input.weightsTotal > 100
          ? "Weights above 100% overstate progress — correct the weights"
          : "Part of the scope has no work item yet, so progress can't reach 100%",
      responsible: "PM",
      when: "Setup",
      href: "#progress",
      amount: null,
      age: 0,
    });
  }

  for (const r of input.rfis ?? []) {
    const age = ageDays(r.createdAt, now);
    if (r.status === "OPEN") {
      const mine = r.canAnswer ?? (isApprover || r.assigneeId === viewer.userId);
      if (r.addressedTo === "INTERNAL" && mine && (r.dueState === "overdue" || r.dueState === "due-soon" || age > 3)) {
        items.push({
          key: `rfi-${r.id}`,
          severity: r.dueState === "overdue" ? 2 : 1,
          title: `${r.number} needs an answer: ${r.subject}`,
          detail: r.dueState === "overdue" ? "Past its due date" : "Due soon or waiting several days",
          responsible: r.assigneeName ?? "PM / Owner",
          when: age === 0 ? "Raised today" : `Open ${age}d`,
          href: "#rfis",
          amount: null,
          age,
        });
      }
      if (r.addressedTo === "INTERNAL" && r.needsApproval && viewer.role === "OWNER") {
        items.push({
          key: `rfi-approve-${r.id}`,
          severity: 1,
          title: `${r.number} is waiting for your approval: ${r.subject}`,
          detail: `${r.assigneeName ?? "The foreman"} is assigned but can't answer until you approve it`,
          responsible: "Owner",
          when: age === 0 ? "Raised today" : `Open ${age}d`,
          href: "#rfis",
          amount: null,
          age,
        });
      }
      if (r.addressedTo === "CLIENT" && isApprover && (r.dueState === "overdue" || age > 5)) {
        items.push({
          key: `rfi-${r.id}`,
          severity: r.dueState === "overdue" ? 2 : 1,
          title: `${r.number} awaiting the client: ${r.subject}`,
          detail: "Follow up with the client if it has stalled",
          responsible: "Client",
          when: `Open ${age}d`,
          href: "#rfis",
          amount: null,
          age,
        });
      }
    }
    if (r.status === "ANSWERED" && (isApprover || r.raisedById === viewer.userId)) {
      items.push({
        key: `rfi-${r.id}`,
        severity: 1,
        title: `${r.number} answered — review and close: ${r.subject}`,
        detail: "Confirm the answer resolves it, or reopen it",
        responsible: "Whoever raised it",
        when: "Answered",
        href: "#rfis",
        amount: null,
        age,
      });
    }
  }

  for (const f of input.findings ?? []) {
    if (f.status === "CLOSED") continue;
    const mine = f.ownerId === viewer.userId;
    const age = ageDays(f.createdAt, now);
    const high = f.severity === "CRITICAL" || f.severity === "HIGH";
    if (f.status === "READY_FOR_REVIEW") {
      const canReview = viewer.role === "OWNER" || (viewer.role === "PM" && f.closureSubmittedById !== viewer.userId);
      if (canReview) {
        items.push({ key: `fnd-${f.id}`, severity: 1, title: `Review the fix: ${f.number} ${f.title}`, detail: "The fix was submitted — accept it or send it back", responsible: "PM / Owner", when: "Ready for review", href: "#quality", amount: null, age });
      }
      continue;
    }
    if (!(isApprover || mine)) continue;
    if (f.dueState === "overdue") {
      items.push({ key: `fnd-${f.id}`, severity: high ? 2 : 1, title: `Overdue ${f.severity.toLowerCase()} finding: ${f.number} ${f.title}`, detail: mine ? "Assigned to you — past its fix-by date" : "Past its fix-by date", responsible: "Assignee", when: "Overdue", href: "#quality", amount: null, age });
    } else if (f.severity === "CRITICAL" && isApprover) {
      items.push({ key: `fnd-${f.id}`, severity: 2, title: `Critical finding open: ${f.number} ${f.title}`, detail: "Needs a fix and closure evidence", responsible: "Assignee", when: `Open ${age}d`, href: "#quality", amount: null, age });
    } else if (mine && (f.dueState === "due-soon" || high)) {
      items.push({ key: `fnd-${f.id}`, severity: 1, title: `Assigned to you: ${f.number} ${f.title}`, detail: f.dueState === "due-soon" ? "Fix-by date is close" : "High-severity finding", responsible: "You", when: "Assigned", href: "#quality", amount: null, age });
    }
  }

  if (isApprover && input.closeout) {
    const c = input.closeout;
    if (c.projectStatus === "TURNED_OVER" && (c.requiredOpen > 0 || c.openDefectsAndPunch > 0)) {
      items.push({ key: "closeout", severity: 2, title: "Turned over with closeout still open", detail: `${c.requiredOpen} required item${c.requiredOpen === 1 ? "" : "s"} and ${c.openDefectsAndPunch} defect/punch item${c.openDefectsAndPunch === 1 ? "" : "s"} outstanding`, responsible: "PM", when: "Closeout", href: "#closeout", amount: null, age: 0 });
    } else if (c.projectStatus === "FOR_PUNCHLIST") {
      if (c.total === 0) {
        items.push({ key: "closeout", severity: 1, title: "Start the closeout checklist", detail: "The project is at punch-list stage with no closeout checklist", responsible: "PM", when: "Closeout", href: "#closeout", amount: null, age: 0 });
      } else if (c.requiredOpen > 0) {
        items.push({ key: "closeout", severity: 1, title: `Closeout: ${c.requiredOpen} required item${c.requiredOpen === 1 ? "" : "s"} still open`, detail: "Finish the checklist before turnover", responsible: "PM", when: "Closeout", href: "#closeout", amount: null, age: 0 });
      }
    }
  }

  if (viewer.showMoney) {
    for (const b of input.billing ?? []) {
      if (b.outstanding <= 0) continue;
      if (b.state === "overdue") {
        items.push({
          key: `bill-${b.id}`,
          severity: (b.daysOverdue ?? 0) > 30 ? 2 : 1,
          title: `Payment overdue: ${b.label}`,
          detail: `${b.daysOverdue}d past the due date — invoice issued, payment not received`,
          responsible: "Accounting",
          when: `${b.daysOverdue}d overdue`,
          href: "#commercial",
          amount: b.outstanding,
          age: b.daysOverdue ?? 0,
        });
      } else if (b.state === "due-not-invoiced") {
        items.push({
          key: `bill-${b.id}`,
          severity: 1,
          title: `Ready to invoice: ${b.label}`,
          detail: "Marked due but no invoice recorded",
          responsible: "Accounting",
          when: "Due",
          href: "#commercial",
          amount: b.outstanding,
          age: 0,
        });
      }
    }
    for (const r of input.retention ?? []) {
      if (r.overdue) {
        items.push({
          key: `ret-${r.id}`,
          severity: 1,
          title: `Retention release date passed: ${r.label}`,
          detail: `${Math.abs(r.daysUntil ?? 0)}d past the expected release — follow up with the client`,
          responsible: "Accounting",
          when: `${Math.abs(r.daysUntil ?? 0)}d overdue`,
          href: "#commercial",
          amount: r.outstanding,
          age: Math.abs(r.daysUntil ?? 0),
        });
      }
    }
  }

  if (isApprover) {
    for (const c of input.potentialChanges ?? []) {
      const age = ageDays(c.createdAt, now);
      if (age > 14) {
        items.push({
          key: `pot-${c.id}`,
          severity: 1,
          title: `Potential change not yet priced or sent: ${c.title}`,
          detail: "Decide whether to price it for the client or withdraw it",
          responsible: "PM / Owner",
          when: `Logged ${age}d ago`,
          href: "#changes",
          amount: null,
          age,
        });
      }
    }
  }

  if (isApprover) {
    for (const w of input.workRequests ?? []) {
      const age = ageDays(w.createdAt, now);
      if (w.status === "REQUESTED") {
        items.push({
          key: `aw-${w.id}`,
          severity: age > 2 ? 2 : 1,
          title: `Client request: ${w.title}`,
          detail: `${w.number} — acknowledge it, price it, then send a quotation or decline`,
          responsible: "PM / Owner",
          when: age === 0 ? "Requested today" : `Waiting ${age}d`,
          href: "#additional-work",
          amount: null,
          age,
        });
      } else if (w.status === "UNDER_REVIEW" && age > 5) {
        items.push({
          key: `aw-${w.id}`,
          severity: 1,
          title: `Client request still being priced: ${w.title}`,
          detail: `${w.number} — the client is waiting for a decision`,
          responsible: "PM / Owner",
          when: `Open ${age}d`,
          href: "#additional-work",
          amount: null,
          age,
        });
      }
    }
  }

  for (const m of input.milestones ?? []) {
    const mine = isApprover || m.responsibleId === viewer.userId;
    if (!mine) continue;
    const slip = m.varianceDays != null && m.varianceDays > 0 ? ` · forecast ${m.varianceDays}d past baseline` : "";
    if (m.health === "overdue") {
      items.push({ key: `ms-${m.id}`, severity: 2, title: `Milestone overdue: ${m.title}`, detail: `${m.overdueDays}d past its finish date${slip}`, responsible: "PM", when: "Schedule", href: "#schedule", amount: null, age: m.overdueDays ?? 0 });
    } else if (m.health === "blocked") {
      items.push({ key: `ms-${m.id}`, severity: 2, title: `Milestone blocked: ${m.title}`, detail: "Marked blocked — clear the blocker or update the plan", responsible: "PM", when: "Schedule", href: "#schedule", amount: null, age: 0 });
    } else if (m.health === "late" || m.health === "watch") {
      items.push({ key: `ms-${m.id}`, severity: m.health === "late" ? 2 : 1, title: `Milestone slipping: ${m.title}`, detail: `Forecast ${m.varianceDays}d past baseline`, responsible: "PM", when: "Schedule", href: "#schedule", amount: null, age: m.varianceDays ?? 0 });
    } else if (m.dueInDays != null && m.dueInDays >= 0 && m.dueInDays <= 7) {
      items.push({ key: `ms-${m.id}`, severity: 1, title: `Milestone due in ${m.dueInDays}d: ${m.title}`, detail: "Confirm it will finish on time", responsible: "PM", when: "Schedule", href: "#schedule", amount: null, age: 0 });
    }
  }

  if (viewer.showMargin && input.isOngoing && input.costState === "no-cost") {
    items.push({
      key: "cost",
      severity: 1,
      title: "Progress reported but no cost recorded",
      detail: "Forecast margin stays unavailable until costs are posted",
      responsible: "Accounting",
      when: "Data gap",
      href: "#overview",
      amount: null,
      age: 0,
    });
  }

  return items
    .sort((a, b) => b.severity - a.severity || b.age - a.age)
    .map(({ age: _age, ...rest }) => rest);
}
