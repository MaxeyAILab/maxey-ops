import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fmtDate, fmtDateTime, php } from "@/lib/format";
import { Badge, Card, CardBody, CardHeader, Stat, Table, Td, Th } from "@/components/ui";
import {
  ChangeOrderForm,
  DeleteChangeOrderButton,
  EditChangeOrderButton,
  EditProgressEntryButton,
  PaymentForm,
  ProgressForm,
} from "@/components/project-actions";
import { PaymentList } from "@/components/payment-list";
import { AccountToggleButton, CreatePortalAccessForm } from "@/components/portal-access";
import { AccomplishmentRadial, WorkItemWeightBars } from "@/components/charts";
import { DailyReportCard, DailyReportForm, type DailyReportDisplay } from "@/components/daily-report-actions";
import { DAILY_REPORT_LIFETIME_DAYS } from "@/lib/daily-reports";
import { PhotoThumbnails } from "@/components/photo-viewer";
import { runGross } from "@/lib/finance";
import { canAccess } from "@/lib/access";
import { computeWorkItemStatuses, summarizeProgress, weightTotal } from "@/lib/progress";
import { computeForecast } from "@/lib/forecast";
import { computeSchedule } from "@/lib/schedule";
import { buildActionQueue } from "@/lib/action-queue";
import { mergeActivity, type ActivityItem } from "@/lib/project-activity";
import { COMPLETED_STATUSES, ONGOING_STATUSES } from "@/lib/project-status";
import { computeMilestoneHealth, manilaToday, upcomingMilestones } from "@/lib/milestones";
import {
  canCancelRfi,
  canCloseRfi,
  canManageRfi,
  canRaiseRfi,
  canRespondToRfi,
  formatRfiNumber,
  rfiDueState,
} from "@/lib/rfi";
import { HEALTH_CHIP, HEALTH_ICON, HEALTH_LABEL, MilestoneTimeline } from "@/components/milestone-timeline";
import { AddMilestoneForm, MilestoneControls } from "@/components/milestone-actions";
import { NewRfiForm, RfiControls } from "@/components/rfi-actions";
import { WorkRequestControls } from "@/components/work-request-actions";
import { BillingDetailsButton, ChangeLifecycleControls, PotentialChangeForm } from "@/components/commercial-actions";
import {
  BILLING_LABEL,
  billingCoverage,
  commitmentSummary,
  costFreshness,
  paymentTermState,
  receivablesAging,
  reconcileContract,
  retentionSchedule,
  type BillingState,
} from "@/lib/billing";
import { CHANGE_ORDER_LABEL } from "@/lib/change-orders";
import { requisitionAmount } from "@/lib/requisitions";
import { AddDocumentForm, CloseoutChecklist, DocumentControls, FindingControls, NewFindingForm } from "@/components/quality-actions";
import {
  FINDING_TYPE_LABEL,
  canCloseFinding,
  canRaiseFinding,
  canReopenFinding,
  canSendBackFinding,
  canViewFinding,
  canWorkFinding,
  findingCounts,
  findingDueState,
  formatFindingNumber,
} from "@/lib/findings";
import { closeoutProgress } from "@/lib/closeout";
import { currentRevision, nextRevisionLabel } from "@/lib/documents";
import { HistoryExportButton } from "@/components/project-overview";
import { canReviewWorkRequest, formatWorkRequestNumber } from "@/lib/work-requests";
import { Fig, FigureToggle, FigureVisibilityProvider } from "@/components/figure-visibility";
import { ActivityFeed, ProgressReviewControls, ProjectSectionNav, type ActivityRow } from "@/components/project-overview";

export const dynamic = "force-dynamic";

const REVIEW_LABEL = { SUBMITTED: "Awaiting review", QUERIED: "Queried", APPROVED: "Approved" } as const;
const REVIEW_TONE = {
  SUBMITTED: "bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300",
  QUERIED: "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300",
  APPROVED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
} as const;
const IMPACT_LABEL: Record<string, string> = {
  UNKNOWN: "unknown (not assessed)",
  NONE_IDENTIFIED: "none identified",
  POSSIBLE: "possible",
  ASSESSED: "assessed",
};
const CO_LABEL: Record<string, string> = { POTENTIAL: "potential", PENDING_CLIENT: "awaiting client", APPROVED: "approved", REJECTED: "rejected", WITHDRAWN: "withdrawn" };
const BILLING_TONE: Record<BillingState, string> = {
  paid: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
  overdue: "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300",
  partial: "bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300",
  billed: "bg-blue-100 text-blue-900 dark:bg-blue-950/60 dark:text-blue-300",
  "due-not-invoiced": "bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300",
  "not-billed": "bg-ink-200 text-ink-700",
};
const CO_TONE: Record<string, string> = {
  POTENTIAL: "bg-blue-100 text-blue-900 dark:bg-blue-950/60 dark:text-blue-300",
  PENDING_CLIENT: "bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300",
  APPROVED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
  REJECTED: "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300",
  WITHDRAWN: "bg-ink-200 text-ink-700",
};

export default async function ProjectDetailPage({ params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role === "CLIENT") redirect("/portal");
  if (!canAccess(user.role, user.department, "/projects", user.customMenus, user.useCustomMenus)) {
    redirect("/attendance");
  }

  const p = await prisma.project.findUnique({
    where: { id: params.id },
    include: {
      client: { include: { users: { where: { role: "CLIENT" } } } },
      paymentTerms: { orderBy: { sortOrder: "asc" }, include: { payments: true } },
      payments: { orderBy: { dateReceived: "desc" }, include: { recordedBy: { select: { name: true } } } },
      requisitions: {
        orderBy: { submittedAt: "desc" },
        include: { purchaseOrder: true, submittedBy: { select: { name: true } } },
      },
      payrollRuns: { where: { status: { in: ["APPROVED", "PAID"] } } },
      changeOrders: { orderBy: { createdAt: "desc" } },
      progressEntries: {
        orderBy: { createdAt: "desc" },
        include: { submittedBy: { select: { name: true } } },
      },
      dailyReports: {
        orderBy: { reportDate: "desc" },
        include: { submittedBy: { select: { name: true } } },
      },
      instructions: {
        where: { status: { notIn: ["COMPLETED", "CANCELLED"] } },
        select: { id: true, taskId: true, title: true, text: true, dueDate: true, status: true, priority: true },
      },
      assignments: { where: { active: true }, include: { user: { select: { name: true, role: true } } } },
      activityLogs: { orderBy: { createdAt: "desc" }, take: 30 },
      milestones: {
        orderBy: { sortOrder: "asc" },
        include: { revisions: { orderBy: { revision: "asc" } }, responsible: { select: { name: true } } },
      },
      findings: {
        orderBy: { number: "desc" },
        include: { owner: { select: { name: true } }, raisedBy: { select: { name: true } } },
      },
      closeoutItems: { orderBy: { sortOrder: "asc" } },
      documents: { orderBy: { createdAt: "desc" }, include: { revisions: { orderBy: { createdAt: "desc" } } } },
      workRequests: {
        orderBy: { number: "desc" },
        include: { requestedBy: { select: { name: true } }, changeOrder: { select: { title: true, status: true } } },
      },
      rfis: {
        orderBy: { number: "desc" },
        include: {
          assignee: { select: { name: true } },
          raisedBy: { select: { name: true } },
          milestone: { select: { title: true } },
          siteInstruction: { select: { taskId: true, title: true, text: true } },
          changeOrder: { select: { title: true } },
          document: { select: { title: true, docNo: true } },
        },
      },
    },
  });
  if (!p) notFound();

  const now = new Date();
  const showMoney = ["OWNER", "ACCOUNTING", "PM"].includes(user.role);
  // Committed cost and margin reveal the company's actual profitability on
  // the job — kept to Owner only, even though Accounting/PM see the rest of
  // the money figures (contract value, received, progress).
  const showMargin = user.role === "OWNER";
  const canRecordPayment = ["OWNER", "ACCOUNTING"].includes(user.role);
  const canCreateCO = ["OWNER", "PM"].includes(user.role);
  const canProgress = ["OWNER", "PM", "FOREMAN"].includes(user.role);
  const canReview = ["OWNER", "PM"].includes(user.role);

  const contractValue = Number(p.contractValue);
  const received = p.payments.reduce((s, x) => s + Number(x.amount), 0);
  const laborCost = p.payrollRuns.reduce((s, r) => s + runGross(r.entries), 0);
  // Same rule as finance and the dashboard (requisitionAmount): a cancelled PO commits nothing.
  const committed =
    laborCost +
    p.requisitions
      .filter((r) => ["APPROVED", "PO_ISSUED", "DELIVERED"].includes(r.status))
      .reduce((s, r) => s + requisitionAmount(r), 0);
  const retentionHeld = p.paymentTerms
    .filter((t) => t.type === "RETENTION" && t.status !== "PAID")
    .reduce((s, t) => s + Number(t.amount), 0);
  const pendingCOAmount = p.changeOrders
    .filter((c) => c.status === "PENDING_CLIENT")
    .reduce((s, c) => s + Number(c.costImpact), 0);
  const dueTerms = p.paymentTerms
    .filter((t) => t.status === "DUE")
    .map((t) => ({
      id: t.id,
      label: t.label,
      outstanding: Math.max(Number(t.amount) - t.payments.reduce((s, x) => s + Number(x.amount), 0), 0),
    }));

  // ----- Phase 4: quality & safety, closeout, documents -----
  const viewerRef = { id: user.id, role: user.role };
  const visibleFindings = p.findings.filter((f) => canViewFinding(f, viewerRef));
  const hiddenFindingCount = p.findings.length - visibleFindings.length;
  const fCounts = findingCounts(visibleFindings, now);
  const openFindings = visibleFindings.filter((f) => f.status !== "CLOSED");
  const closedFindings = visibleFindings.filter((f) => f.status === "CLOSED");
  const openDefectsAndPunch = p.findings.filter((f) => f.status !== "CLOSED" && (f.type === "DEFECT" || f.type === "PUNCH_ITEM")).length;
  const closeout = closeoutProgress(p.closeoutItems, openDefectsAndPunch);
  const docOptions = p.documents.map((d) => ({ id: d.id, label: `${d.docNo ? d.docNo + " — " : ""}${d.title}` }));
  const canManageQuality = user.role === "OWNER" || user.role === "PM";

  // ----- Phase 3: billing, reconciliation, commitments -----
  const termRows = p.paymentTerms.map((t) => {
    const paid = t.payments.reduce((sum, x) => sum + Number(x.amount), 0);
    const input = {
      status: t.status,
      amount: Number(t.amount),
      paid,
      invoicedAt: t.invoicedAt,
      certifiedAt: t.certifiedAt,
      dueDate: t.dueDate,
    };
    return { t, paid, input, state: paymentTermState(input, now) };
  });
  const aging = receivablesAging(termRows.map((r) => r.input), now);
  const retentionRows = retentionSchedule(
    termRows.map((r) => ({
      id: r.t.id,
      label: r.t.label,
      type: r.t.type,
      status: r.t.status,
      amount: Number(r.t.amount),
      paid: r.paid,
      retentionReleaseDate: r.t.retentionReleaseDate,
    })),
    now
  );
  const commitments = commitmentSummary(
    p.requisitions.map((r) => ({
      status: r.status,
      estimatedCost: r.estimatedCost != null ? Number(r.estimatedCost) : null,
      po: r.purchaseOrder ? { totalCost: Number(r.purchaseOrder.totalCost), status: r.purchaseOrder.status } : null,
    }))
  );
  const reconciliation = reconcileContract({
    currentContract: contractValue,
    changeOrders: p.changeOrders.map((c) => ({
      status: c.status,
      costImpact: Number(c.costImpact),
      estimatedCost: c.estimatedCost != null ? Number(c.estimatedCost) : null,
    })),
  });
  const coverage = billingCoverage(p.paymentTerms.map((t) => Number(t.amount)), contractValue);
  const latestCostAt = [
    ...p.requisitions.filter((r) => ["APPROVED", "PO_ISSUED", "DELIVERED"].includes(r.status)).map((r) => r.approvedAt ?? r.submittedAt),
    ...p.payrollRuns.map((r) => r.createdAt),
  ].reduce<Date | null>((max, d) => (!max || d > max ? d : max), null);
  const costFresh = costFreshness(latestCostAt, new Date());

  // Verified progress counts approved entries only; submitted work is shown beside it.
  const workItemStatuses = computeWorkItemStatuses(p.progressEntries);
  const summary = summarizeProgress(p.progressEntries);
  const accomplishmentPct = summary.verifiedPct;
  const hasWeights = p.progressEntries.some((e) => e.workItem && e.weight != null);
  const weightsTotal = hasWeights ? weightTotal(p.progressEntries) : null;

  const isCompleted = (COMPLETED_STATUSES as string[]).includes(p.status);
  const isOngoing = (ONGOING_STATUSES as string[]).includes(p.status);
  const forecast = computeForecast({ contract: contractValue, committed, pct: accomplishmentPct, isCompleted });
  const schedule = computeSchedule({
    now,
    start: p.startDate,
    targetEnd: p.targetEndDate,
    pct: accomplishmentPct,
    isCompleted,
  });

  const reviewerIds = Array.from(new Set(p.progressEntries.map((e) => e.reviewedById).filter((x): x is string => !!x)));
  const reviewers = reviewerIds.length
    ? await prisma.user.findMany({ where: { id: { in: reviewerIds } }, select: { id: true, name: true } })
    : [];
  const reviewerName = new Map(reviewers.map((r) => [r.id, r.name]));
  const manager = p.assignments.find((a) => a.user.role === "PM")?.user.name ?? null;

  const isOwnerUser = user.role === "OWNER";
  const staff = await prisma.user.findMany({
    where: { active: true, role: { not: "CLIENT" } },
    select: { id: true, name: true, role: true },
    orderBy: { name: "asc" },
  });
  const staffOptions = staff.map((u) => ({ id: u.id, name: u.name, label: `${u.name} (${u.role.toLowerCase()})` }));

  const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
  const todayKey = new Date(manilaToday(now) * 86_400_000).toISOString().slice(0, 10);
  const milestoneRows = p.milestones.map((m) => {
    const h = computeMilestoneHealth(
      { status: m.status, baselineFinish: m.baselineFinish, forecastFinish: m.forecastFinish, actualFinish: m.actualFinish },
      now
    );
    return { m, ...h };
  });
  const timeline = milestoneRows.map(({ m, health }) => ({
    id: m.id,
    title: m.title,
    status: m.status,
    health,
    baselineStart: ymd(m.baselineStart),
    baselineFinish: ymd(m.baselineFinish),
    forecastStart: ymd(m.forecastStart),
    forecastFinish: ymd(m.forecastFinish),
    actualFinish: ymd(m.actualFinish),
  }));
  const lookahead = upcomingMilestones(
    milestoneRows.map((r) => ({ ...r.m, health: r.health, overdueDays: r.overdueDays })),
    now,
    30
  ).slice(0, 5);
  const actor = { id: user.id, role: user.role, clientId: user.clientId };
  const canRaise = canRaiseRfi(user.role, "INTERNAL");
  const openRfis = p.rfis.filter((r) => r.status === "OPEN" || r.status === "ANSWERED");
  const closedRfis = p.rfis.filter((r) => r.status === "CLOSED" || r.status === "CANCELLED");

  const actions = buildActionQueue({
    now,
    viewer: { userId: user.id, role: user.role, showMoney, showMargin },
    progress: p.progressEntries.map((e) => ({
      id: e.id,
      workItem: e.workItem,
      pct: Number(e.pctComplete),
      status: e.reviewStatus,
      submittedById: e.submittedById,
      submittedByName: e.submittedBy.name,
      createdAt: e.createdAt,
      reviewNote: e.reviewNote,
    })),
    changeOrders: p.changeOrders.map((c) => ({
      id: c.id,
      title: c.title,
      status: c.status,
      costImpact: Number(c.costImpact),
      createdAt: c.createdAt,
    })),
    requisitions: p.requisitions.map((r) => ({
      id: r.id,
      status: r.status,
      urgency: r.urgency,
      submittedByName: r.submittedBy.name,
      submittedAt: r.submittedAt,
      estimatedCost: r.estimatedCost != null ? Number(r.estimatedCost) : null,
    })),
    dueTerms,
    findings: visibleFindings.map((f) => ({
      id: f.id,
      number: formatFindingNumber(f.number),
      title: f.title,
      severity: f.severity,
      status: f.status,
      ownerId: f.ownerId,
      closureSubmittedById: f.closureSubmittedById,
      dueState: findingDueState(f, now),
      createdAt: f.createdAt,
    })),
    closeout: {
      projectStatus: p.status,
      total: closeout.total,
      requiredOpen: closeout.requiredTotal - closeout.requiredDone,
      openDefectsAndPunch,
    },
    billing: termRows.map((r) => ({
      id: r.t.id,
      label: r.t.label,
      state: r.state.state,
      daysOverdue: r.state.daysOverdue,
      outstanding: r.state.outstanding,
    })),
    retention: retentionRows.map((r) => ({ id: r.id, label: r.label, outstanding: r.outstanding, overdue: r.overdue, daysUntil: r.daysUntil })),
    potentialChanges: p.changeOrders.filter((c) => c.status === "POTENTIAL").map((c) => ({ id: c.id, title: c.title, createdAt: c.createdAt })),
    instructions: p.instructions.map((i) => ({
      id: i.id,
      label: i.taskId ?? i.title ?? i.text.slice(0, 40),
      dueDate: i.dueDate,
      status: i.status,
      priority: i.priority,
    })),
    schedule: { state: schedule.state, varianceDays: schedule.varianceDays },
    weightsTotal,
    costState: forecast.costState,
    isOngoing,
    workRequests: p.workRequests.map((w) => ({
      id: w.id,
      number: formatWorkRequestNumber(w.number),
      title: w.title,
      status: w.status,
      createdAt: w.createdAt,
    })),
    rfis: p.rfis.map((r) => ({
      id: r.id,
      number: formatRfiNumber(r.number),
      subject: r.subject,
      status: r.status,
      addressedTo: r.addressedTo,
      assigneeId: r.assigneeId,
      assigneeName: r.assignee?.name ?? null,
      raisedById: r.raisedById,
      dueState: rfiDueState(r, now),
      createdAt: r.createdAt,
    })),
    milestones: milestoneRows.map(({ m, health, varianceDays, overdueDays }) => {
      const current = m.forecastFinish ?? m.baselineFinish;
      return {
        id: m.id,
        title: m.title,
        health,
        varianceDays,
        overdueDays,
        responsibleId: m.responsibleId,
        dueInDays: current && m.status !== "COMPLETED" ? Math.floor(current.getTime() / 86_400_000) - manilaToday(now) : null,
      };
    }),
  });

  // Recent site activity: live records plus the permanent log lines.
  const live: (ActivityItem & { refId?: string })[] = [
    ...p.progressEntries.slice(0, 15).map((e) => ({
      key: `pe-${e.id}`,
      type: "progress" as const,
      at: e.reviewedAt ?? e.createdAt,
      title: `${e.workItem ?? "Progress"} — ${Number(e.pctComplete).toFixed(0)}% ${REVIEW_LABEL[e.reviewStatus].toLowerCase()}`,
      detail: e.reviewedById ? `reviewed by ${reviewerName.get(e.reviewedById) ?? "—"}` : "submitted",
      actor: e.submittedBy.name,
      href: "#progress",
      refId: e.id,
    })),
    ...p.dailyReports.map((r) => ({
      key: `dr-${r.id}`,
      type: "report" as const,
      at: r.createdAt,
      title: `${r.reportNo} · ${r.reportDate.toISOString().slice(0, 10)} — ${r.workProgress.slice(0, 80)}`,
      detail: "",
      actor: r.submittedBy.name,
      href: "#reports",
      refId: r.id,
    })),
    ...p.changeOrders.map((c) => ({
      key: `co-${c.id}`,
      type: "change" as const,
      at: c.clientResponseAt ?? c.createdAt,
      title: `Change order “${c.title}” — ${CO_LABEL[c.status] ?? c.status.toLowerCase()}`,
      detail: "",
      actor: c.clientResponseAt ? "Client" : "Maxey",
      href: "#changes",
    })),
    ...visibleFindings.slice(0, 8).map((f) => ({
      key: `fd-${f.id}`,
      type: "quality" as const,
      at: f.closedAt ?? f.closureSubmittedAt ?? f.createdAt,
      title: `${formatFindingNumber(f.number)} ${f.status === "CLOSED" ? "closed" : f.status === "READY_FOR_REVIEW" ? "fix submitted" : "raised"} — ${f.restricted ? "restricted incident" : f.title}`,
      detail: f.severity.toLowerCase(),
      actor: f.status === "CLOSED" ? (f.closedByName ?? "—") : f.raisedBy.name,
      href: "#quality",
    })),
    ...p.documents.flatMap((d) =>
      d.revisions.slice(0, 2).map((r) => ({
        key: `doc-${r.id}`,
        type: "document" as const,
        at: r.createdAt,
        title: `${d.docNo ? d.docNo + " " : ""}${d.title} — revision ${r.revision}`,
        detail: "document",
        actor: r.uploadedByName,
        href: "#documents",
      }))
    ),
    ...p.workRequests.slice(0, 8).map((w) => ({
      key: `aw-${w.id}`,
      type: "request" as const,
      at: w.reviewedAt ?? w.createdAt,
      title: `${formatWorkRequestNumber(w.number)} ${w.status === "REQUESTED" ? "requested" : w.status === "UNDER_REVIEW" ? "under review" : w.status === "CONVERTED" ? "sent as a change order" : w.status === "DECLINED" ? "declined" : "withdrawn"} — ${w.title}`,
      detail: "additional work",
      actor: w.status === "REQUESTED" || w.status === "WITHDRAWN" ? w.requestedBy.name : (w.reviewedByName ?? w.requestedBy.name),
      href: "#additional-work",
    })),
    ...p.rfis.slice(0, 8).map((r) => ({
      key: `rfi-${r.id}`,
      type: "rfi" as const,
      at: r.respondedAt ?? r.createdAt,
      title: `${formatRfiNumber(r.number)} ${r.respondedAt ? "answered" : "raised"} — ${r.subject}`,
      detail: r.addressedTo === "CLIENT" ? "to the client" : "internal",
      actor: r.respondedAt ? (r.respondedByName ?? "—") : r.raisedBy.name,
      href: "#rfis",
    })),
    ...p.milestones
      .filter((m) => m.status === "COMPLETED" && m.actualFinish)
      .map((m) => ({
        key: `ms-${m.id}`,
        type: "milestone" as const,
        at: m.updatedAt,
        title: `Milestone completed — ${m.title}`,
        detail: "",
        actor: m.responsible?.name ?? "Maxey",
        href: "#schedule",
      })),
    ...p.requisitions.slice(0, 8).map((r) => ({
      key: `rq-${r.id}`,
      type: "requisition" as const,
      at: r.submittedAt,
      title: `Requisition ${r.status.toLowerCase().replace(/_/g, " ")}`,
      detail: "",
      actor: r.submittedBy.name,
      href: `/requisitions/${r.id}`,
    })),
    ...(showMoney
      ? p.payments.slice(0, 8).map((x) => ({
          key: `pm-${x.id}`,
          type: "payment" as const,
          at: x.dateReceived,
          title: `Payment received ⟦${php(Number(x.amount))}⟧`,
          detail: x.method ?? "",
          actor: x.recordedBy.name,
          href: "#commercial",
        }))
      : []),
  ];
  const feed = mergeActivity(
    live,
    p.activityLogs
      .filter((l) => l.type === "DAILY_REPORT")
      .map((l) => ({ ...l, href: "#reports" })),
    12
  );
  const feedRows: ActivityRow[] = feed.map((f) => ({ ...f, at: f.at.toISOString() }));
  const lastActivity = feed[0]?.at ?? null;

  const dailyReports: DailyReportDisplay[] = p.dailyReports.map((r) => ({
    id: r.id,
    reportNo: r.reportNo,
    reportDate: r.reportDate.toISOString().slice(0, 10),
    weather: r.weather,
    workingHours: r.workingHours,
    workProgress: r.workProgress,
    deliveries: (r.deliveries as { material: string; qty: string; supplier: string; condition: string }[] | null) ?? [],
    manpower: (r.manpower as { role: string; count: number }[] | null) ?? [],
    equipment: r.equipment,
    siteEvents: r.siteEvents,
    issues: r.issues,
    safety: r.safety,
    weatherNotes: r.weatherNotes,
    plannedNextDay: r.plannedNextDay,
    overallProgress: r.overallProgress,
    visibleToClient: r.visibleToClient,
    submittedById: r.submittedById,
    submittedByName: r.submittedBy.name,
    createdAt: r.createdAt.toISOString(),
    editedAt: r.editedAt ? r.editedAt.toISOString() : null,
    photos: (r.photos as string[] | null) ?? [],
  }));

  const sections = [
    { id: "overview", label: "Overview" },
    { id: "schedule", label: "Schedule" },
    { id: "rfis", label: "RFIs" },
    { id: "additional-work", label: "Additional work" },
    ...(showMoney ? [{ id: "commercial", label: "Commercial" }] : []),
    { id: "changes", label: "Changes" },
    { id: "progress", label: "Progress" },
    { id: "requisitions", label: "Requisitions" },
    { id: "quality", label: "Quality & safety" },
    { id: "closeout", label: "Closeout" },
    { id: "documents", label: "Documents" },
    { id: "reports", label: "Daily reports" },
  ];

  const marginTone = forecast.forecastMarginPct == null ? "default" : forecast.forecastMarginPct >= 0 ? "good" : "bad";
  const scheduleText =
    schedule.state === "done"
      ? "Turned over"
      : schedule.state === "no-target"
        ? "No target finish date set"
        : schedule.state === "overdue"
          ? `Past target finish by ${schedule.varianceDays} days`
          : schedule.state === "late" || schedule.state === "watch"
            ? `Behind plan — ${accomplishmentPct.toFixed(0)}% done, ${schedule.plannedPct?.toFixed(0)}% of time used`
            : schedule.state === "on-plan"
              ? `On plan — ${accomplishmentPct.toFixed(0)}% done, ${schedule.plannedPct?.toFixed(0)}% of time used`
              : "Too early to judge";
  const scheduleTone =
    schedule.state === "overdue" || schedule.state === "late"
      ? "text-red-700 dark:text-red-300"
      : schedule.state === "watch"
        ? "text-amber-800 dark:text-amber-300"
        : "text-ink-700";

  return (
    <FigureVisibilityProvider>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link href="/projects" className="text-xs text-ink-400 hover:text-ink-600">
              ← All projects
            </Link>
            <h1 className="text-xl font-bold text-ink-900">{p.name}</h1>
            <p className="text-xs text-ink-500">
              {p.client.name} · {p.address ?? "no address"} · {p.startDate ? `started ${fmtDate(p.startDate)}` : "not started"}
              {p.targetEndDate && <> · target finish {fmtDate(p.targetEndDate)}</>}
            </p>
            <p className="text-xs text-ink-500">
              PM: {manager ?? "Unassigned"} · {lastActivity ? `last activity ${fmtDateTime(lastActivity)}` : "no activity yet"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {showMoney && <FigureToggle />}
            {canManageQuality && <HistoryExportButton projectId={p.id} />}
            <Link
              href={`/projects/${p.id}/report`}
              className="inline-flex min-h-[36px] items-center rounded-lg border border-ink-200 px-3 py-1.5 text-sm font-medium text-ink-700 hover:bg-ink-50"
            >
              📄 Progress report
            </Link>
            <Badge value={p.status} />
          </div>
        </div>

        <ProjectSectionNav sections={sections} />

        {/* ---------- Overview ---------- */}
        <section id="overview" className="scroll-mt-14 space-y-4">
          {showMoney && (
            <div className={`grid grid-cols-2 gap-3 ${showMargin ? "lg:grid-cols-5" : "lg:grid-cols-3"}`}>
              <Stat
                label="Contract value"
                value={
                  <span className="text-[17px] sm:text-2xl">
                    <Fig>{php(contractValue)}</Fig>
                  </span>
                }
                sub={
                  <>
                    approved, incl. approved change orders
                    {pendingCOAmount !== 0 && (
                      <>
                        {" "}
                        · <Fig>{php(pendingCOAmount)}</Fig> pending, not included
                      </>
                    )}
                  </>
                }
              />
              <Stat
                label="Received"
                value={
                  <span className="text-[17px] sm:text-2xl">
                    <Fig>{php(received)}</Fig>
                  </span>
                }
                tone="good"
                sub={
                  <>
                    cash actually received · retention held <Fig>{php(retentionHeld)}</Fig>
                  </>
                }
              />
              {showMargin && (
                <>
                  <Stat
                    label="Committed cost"
                    value={
                  <span className="text-[17px] sm:text-2xl">
                    <Fig>{php(committed)}</Fig>
                  </span>
                }
                    tone="bad"
                    sub={
                      <>
                        approved reqs, POs + payroll <Fig>{php(laborCost)}</Fig> · not invoices
                      </>
                    }
                  />
                  <Stat
                    label="Forecast margin"
                    value={
                      forecast.forecastMarginPct != null ? (
                        <Fig>{`${forecast.forecastMarginPct.toFixed(1)}%`}</Fig>
                      ) : (
                        <span className="text-base font-semibold text-ink-600">
                          {forecast.costState === "no-progress" ? "Awaiting progress" : "Pending cost data"}
                        </span>
                      )
                    }
                    tone={marginTone}
                    sub={
                      forecast.forecastProfit != null ? (
                        <>
                          forecast profit <Fig>{php(forecast.forecastProfit)}</Fig>
                          {forecast.costState === "early" ? " · early estimate" : ""} · cost to date ÷ verified progress
                          {costFresh.costAgeDays != null && (
                            <span className={costFresh.costStale ? "font-medium text-amber-800 dark:text-amber-300" : ""}>
                              {" "}
                              · cost data {costFresh.costAgeDays === 0 ? "updated today" : `${costFresh.costAgeDays}d old`}
                              {costFresh.costStale ? " — stale" : ""}
                            </span>
                          )}
                        </>
                      ) : (
                        "not shown until costs and verified progress both exist"
                      )
                    }
                  />
                </>
              )}
              <Stat
                label="Verified progress"
                value={`${accomplishmentPct.toFixed(0)}%`}
                tone="brand"
                sub={
                  summary.submittedPct - accomplishmentPct > 0.5
                    ? `${summary.submittedPct.toFixed(0)}% if pending entries are approved`
                    : "approved entries only"
                }
              />
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            <Card>
              <CardHeader
                title="Progress & schedule"
                subtitle={
                  summary.lastVerifiedAt ? `Last verified ${fmtDateTime(summary.lastVerifiedAt)}` : "Nothing verified yet"
                }
              />
              <CardBody className="space-y-3">
                <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-center">
                  <AccomplishmentRadial items={workItemStatuses} />
                  <div className="space-y-1.5 text-sm">
                    <div>
                      <span className="text-2xl font-bold tabular-nums text-ink-900">{accomplishmentPct.toFixed(0)}%</span>{" "}
                      <span className="text-xs text-ink-500">verified (approved entries)</span>
                    </div>
                    {summary.pendingCount > 0 && (
                      <div className="text-xs text-amber-800 dark:text-amber-300">
                        ● {summary.pendingCount} entr{summary.pendingCount === 1 ? "y" : "ies"} awaiting review
                        {summary.submittedPct - accomplishmentPct > 0.5 && <> (would reach {summary.submittedPct.toFixed(0)}%)</>}
                      </div>
                    )}
                    {summary.queriedCount > 0 && (
                      <div className="text-xs text-red-700 dark:text-red-300">
                        ▲ {summary.queriedCount} entr{summary.queriedCount === 1 ? "y" : "ies"} queried — waiting for the foreman
                      </div>
                    )}
                    <div className={`text-xs ${scheduleTone}`}>
                      {schedule.state === "overdue" || schedule.state === "late" ? "▲ " : schedule.state === "watch" ? "● " : "✓ "}
                      {scheduleText}
                      {schedule.forecastFinish && <> · forecast finish ~{fmtDate(schedule.forecastFinish)}</>}
                    </div>
                    {weightsTotal != null && Math.abs(weightsTotal - 100) > 0.01 && (
                      <div className="text-xs text-amber-800 dark:text-amber-300">
                        ● Work-item weights total {weightsTotal.toFixed(0)}% (should be 100%)
                      </div>
                    )}
                  </div>
                </div>
                <p className="text-[11px] leading-snug text-ink-500">
                  The chart summarises approved work items; check each item’s evidence in the Progress section. Milestones and baseline
                  dates are planned for a later phase.
                </p>
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                title={`Needs your action (${actions.length})`}
                subtitle="Overdue or due-soon items for your role on this project"
              />
              <CardBody>
                {actions.length === 0 ? (
                  <p className="py-4 text-sm text-ink-500">✓ Nothing needs your action right now.</p>
                ) : (
                  <ul className="space-y-2">
                    {actions.slice(0, 8).map((a) => (
                      <li key={a.key} className="rounded-sm border border-ink-100 p-2.5 text-sm">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <span
                              className={`mr-1.5 inline-block rounded-sm px-1.5 py-0.5 text-[11px] font-semibold ${
                                a.severity === 2
                                  ? "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300"
                                  : "bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300"
                              }`}
                            >
                              {a.severity === 2 ? "▲ Overdue" : "● Due soon"}
                            </span>
                            <span className="font-medium text-ink-900">{a.title}</span>
                            <div className="text-xs text-ink-500">{a.detail}</div>
                            <div className="text-xs text-ink-500">
                              {a.responsible} · {a.when}
                              {a.amount != null && (
                                <>
                                  {" "}
                                  · <Fig>{php(a.amount)}</Fig>
                                </>
                              )}
                            </div>
                          </div>
                          <Link href={a.href} className="shrink-0 text-xs font-medium text-brand-600 hover:underline">
                            Open →
                          </Link>
                        </div>
                      </li>
                    ))}
                    {actions.length > 8 && <li className="text-xs text-ink-500">+ {actions.length - 8} more</li>}
                  </ul>
                )}
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader
              title="Milestones"
              subtitle={milestoneRows.length ? `${milestoneRows.length} milestone${milestoneRows.length === 1 ? "" : "s"} · approved baseline vs current forecast` : "No milestones yet"}
              action={
                <a href="#schedule" className="text-xs font-medium text-brand-600 hover:underline">
                  Manage →
                </a>
              }
            />
            <CardBody className="space-y-4">
              {milestoneRows.length === 0 ? (
                <p className="text-sm text-ink-500">
                  Add milestones in the Schedule section to track baseline and forecast dates. Until then the status above only compares time used
                  with work done.
                </p>
              ) : (
                <>
                  <MilestoneTimeline milestones={timeline} today={todayKey} />
                  <div>
                    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500">Lookahead — next 30 days and overdue</p>
                    {lookahead.length === 0 ? (
                      <p className="text-sm text-ink-500">✓ Nothing due in the next 30 days.</p>
                    ) : (
                      <ul className="space-y-1.5 text-sm">
                        {lookahead.map((m) => (
                          <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span className={`rounded-sm px-1.5 py-0.5 text-[11px] font-semibold ${HEALTH_CHIP[m.health]}`}>
                              {HEALTH_ICON[m.health]} {HEALTH_LABEL[m.health]}
                            </span>
                            <span className="font-medium text-ink-900">{m.title}</span>
                            <span className="text-xs text-ink-500">
                              {m.forecastFinish ?? m.baselineFinish ? fmtDate(m.forecastFinish ?? m.baselineFinish) : "no date"}
                              {m.overdueDays ? ` · ${m.overdueDays}d overdue` : ""}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Quality, safety & closeout"
              subtitle="Counts of what is open — no rates, because hours worked aren't recorded"
              action={
                <a href="#quality" className="text-xs font-medium text-brand-600 hover:underline">
                  Open →
                </a>
              }
            />
            <CardBody className="grid gap-4 sm:grid-cols-2">
              <div className="text-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Open findings</p>
                <p className="mt-1">
                  <span className="text-2xl font-bold tabular-nums text-ink-900">{fCounts.open}</span>
                  <span className="ml-2 text-xs text-ink-500">
                    {fCounts.openBySeverity.CRITICAL} critical · {fCounts.openBySeverity.HIGH} high · {fCounts.openBySeverity.MEDIUM} medium · {fCounts.openBySeverity.LOW} low
                  </span>
                </p>
                <p className="mt-1 text-xs text-ink-600">
                  {fCounts.overdue > 0 ? <span className="font-medium text-red-700 dark:text-red-300">▲ {fCounts.overdue} past their fix-by date</span> : "✓ None past their fix-by date"}
                  {fCounts.readyForReview > 0 && <> · {fCounts.readyForReview} awaiting review</>}
                  {" · "}
                  {fCounts.closedLast30Days} closed in the last 30 days
                </p>
              </div>
              <div className="text-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Closeout</p>
                {closeout.total === 0 ? (
                  <p className="mt-1 text-xs text-ink-600">No checklist yet. It can be started from the Closeout section.</p>
                ) : (
                  <>
                    <p className="mt-1">
                      <span className="text-2xl font-bold tabular-nums text-ink-900">
                        {closeout.requiredDone}/{closeout.requiredTotal}
                      </span>
                      <span className="ml-2 text-xs text-ink-500">required items done</span>
                    </p>
                    <p className="mt-1 text-xs text-ink-600">
                      {closeout.ready ? "✓ Ready for turnover" : `● Not ready — ${closeout.blockers.join("; ")}`}
                    </p>
                  </>
                )}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Recent site activity" subtitle="Progress, daily reports, changes, requisitions and payments — newest first" />
            <CardBody>
              <ActivityFeed rows={feedRows} />
            </CardBody>
          </Card>
        </section>

        {/* ---------- Schedule: milestones ---------- */}
        <section id="schedule" className="scroll-mt-14">
          <Card>
            <CardHeader
              title={`Milestones (${milestoneRows.length})`}
              subtitle="The baseline is the approved plan (Owner only, every revision kept with a reason). The PM keeps forecast and actual dates current. Slipping = forecast later than baseline; Late = more than 7 days later."
            />
            <CardBody className="space-y-3">
              {milestoneRows.map(({ m, health, varianceDays, overdueDays }) => (
                <div key={m.id} className="rounded-lg border border-ink-100 p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-ink-900">{m.title}</span>
                    <span className={`rounded-sm px-2 py-0.5 text-xs font-semibold ${HEALTH_CHIP[health]}`}>
                      {HEALTH_ICON[health]} {HEALTH_LABEL[health]}
                    </span>
                  </div>
                  {m.description && <p className="mt-1 text-xs text-ink-500">{m.description}</p>}
                  <div className="mt-1.5 grid gap-x-6 gap-y-0.5 text-xs text-ink-600 sm:grid-cols-2">
                    <div>
                      Baseline: {m.baselineStart ? fmtDate(m.baselineStart) : "—"} → {m.baselineFinish ? fmtDate(m.baselineFinish) : "no baseline set"}
                    </div>
                    <div>
                      Forecast: {m.forecastStart ? fmtDate(m.forecastStart) : "—"} → {m.forecastFinish ? fmtDate(m.forecastFinish) : "—"}
                      {varianceDays != null && (
                        <span className={varianceDays > 0 ? " font-medium text-amber-800 dark:text-amber-300" : ""}>
                          {" "}
                          ({varianceDays > 0 ? `+${varianceDays}` : varianceDays === 0 ? "on" : varianceDays} {varianceDays === 0 ? "baseline" : "days vs baseline"})
                        </span>
                      )}
                    </div>
                    {m.actualFinish && <div>Actual finish: {fmtDate(m.actualFinish)}</div>}
                    {overdueDays ? <div className="font-medium text-red-700 dark:text-red-300">{overdueDays} days past its finish date</div> : null}
                    <div>Responsible: {m.responsible?.name ?? "unassigned"}</div>
                    <div>{m.visibleToClient ? "Visible to the client" : "Staff only"}</div>
                  </div>
                  {m.notes && <p className="mt-1.5 rounded-sm bg-ink-100 px-2 py-1 text-xs text-ink-600">Internal note: {m.notes}</p>}
                  {canCreateCO && (
                    <MilestoneControls
                      isOwner={isOwnerUser}
                      staff={staffOptions}
                      m={{
                        id: m.id,
                        title: m.title,
                        description: m.description,
                        status: m.status,
                        baselineStart: ymd(m.baselineStart),
                        baselineFinish: ymd(m.baselineFinish),
                        forecastStart: ymd(m.forecastStart),
                        forecastFinish: ymd(m.forecastFinish),
                        actualFinish: ymd(m.actualFinish),
                        responsibleId: m.responsibleId,
                        notes: m.notes,
                        visibleToClient: m.visibleToClient,
                        revisions: m.revisions.map((r) => ({
                          revision: r.revision,
                          baselineStart: ymd(r.baselineStart),
                          baselineFinish: ymd(r.baselineFinish),
                          reason: r.reason,
                          by: r.revisedByName,
                          at: fmtDate(r.createdAt),
                        })),
                      }}
                    />
                  )}
                </div>
              ))}
              {milestoneRows.length === 0 && <p className="text-sm text-ink-400">No milestones yet.</p>}
              {canCreateCO && (
                <details className="rounded-lg border border-dashed border-ink-200 p-3">
                  <summary className="cursor-pointer text-sm font-medium text-ink-700">+ Add milestone</summary>
                  <div className="mt-3">
                    <AddMilestoneForm projectId={p.id} isOwner={isOwnerUser} staff={staffOptions} />
                  </div>
                </details>
              )}
            </CardBody>
          </Card>
        </section>

        {/* ---------- RFIs ---------- */}
        <section id="rfis" className="scroll-mt-14">
          <Card>
            <CardHeader
              title={`RFIs (${openRfis.length} open or awaiting close)`}
              subtitle="Questions that need an answer. Cost and schedule impact stays “Unknown” until someone assesses it — it never defaults to “none”."
            />
            <CardBody className="space-y-3">
              {openRfis.map((r) => {
                const verdict = canRespondToRfi(r, actor, p.clientId);
                const due = rfiDueState(r, now);
                const label = formatRfiNumber(r.number);
                return (
                  <div key={r.id} className="rounded-lg border border-ink-100 p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-ink-900">
                        {label} · {r.subject}
                      </span>
                      <span className="flex items-center gap-1.5 text-xs">
                        {due === "overdue" && <span className="rounded-sm bg-red-100 px-1.5 py-0.5 font-semibold text-red-800 dark:bg-red-950/60 dark:text-red-300">▲ Overdue</span>}
                        {due === "due-soon" && <span className="rounded-sm bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-900 dark:bg-amber-950/60 dark:text-amber-300">● Due soon</span>}
                        <span className="rounded-sm bg-ink-200 px-1.5 py-0.5 font-semibold text-ink-700">{r.status === "OPEN" ? "Open" : "Answered"}</span>
                        <span className="rounded-sm bg-ink-200 px-1.5 py-0.5 font-semibold text-ink-700">{r.addressedTo === "CLIENT" ? "To client" : "Internal"}</span>
                      </span>
                    </div>
                    <p className="mt-1 whitespace-pre-line text-xs text-ink-700">{r.question}</p>
                    {Array.isArray(r.photos) && (r.photos as string[]).length > 0 && (
                      <div className="mt-2">
                        <PhotoThumbnails photos={(r.photos as string[]).map((src) => ({ src, label: label }))} />
                      </div>
                    )}
                    <div className="mt-1.5 grid gap-x-6 gap-y-0.5 text-xs text-ink-500 sm:grid-cols-2">
                      <div>
                        Raised by {r.raisedBy.name} · {fmtDateTime(r.createdAt)}
                      </div>
                      <div>
                        {r.addressedTo === "CLIENT" ? "Waiting on: the client" : `Assigned to: ${r.assignee?.name ?? "PM / Owner"}`}
                        {r.dueDate && <> · needed by {fmtDate(r.dueDate)}</>}
                      </div>
                      {r.workItem && <div>Work item: {r.workItem}</div>}
                      {r.dailyReportNo && <div>Daily report: {r.dailyReportNo}</div>}
                      {r.milestone && <div>Milestone: {r.milestone.title}</div>}
                      {r.siteInstruction && (
                        <div>
                          Site instruction:{" "}
                          <Link href="/instructions" className="text-brand-600 hover:underline">
                            {r.siteInstruction.taskId ?? r.siteInstruction.title ?? r.siteInstruction.text.slice(0, 30)}
                          </Link>
                        </div>
                      )}
                      {r.changeOrder && <div>Change order: {r.changeOrder.title}</div>}
                      {r.document && (
                        <div>
                          Document: {r.document.docNo ? `${r.document.docNo} — ` : ""}
                          {r.document.title}
                        </div>
                      )}
                    </div>
                    <div className="mt-1.5 text-xs text-ink-600">
                      Cost impact: <strong>{IMPACT_LABEL[r.costImpact]}</strong> · Schedule impact: <strong>{IMPACT_LABEL[r.scheduleImpact]}</strong>
                      {r.scheduleImpactDays != null && <> ({r.scheduleImpactDays > 0 ? "+" : ""}{r.scheduleImpactDays} days)</>}
                      {r.impactNote && <> — {r.impactNote}</>}
                    </div>
                    {r.responseText && (
                      <div className="mt-2 rounded-sm border border-emerald-200 bg-emerald-50 p-2 text-xs text-ink-800 dark:border-emerald-900 dark:bg-emerald-950/30">
                        <div className="font-semibold">Answer — {r.respondedByName}{r.respondedAt && `, ${fmtDateTime(r.respondedAt)}`}</div>
                        <p className="mt-0.5 whitespace-pre-line">{r.responseText}</p>
                        {Array.isArray(r.responsePhotos) && (r.responsePhotos as string[]).length > 0 && (
                          <div className="mt-1.5">
                            <PhotoThumbnails photos={(r.responsePhotos as string[]).map((src) => ({ src, label: `${label} answer` }))} />
                          </div>
                        )}
                      </div>
                    )}
                    <RfiControls
                      staff={staffOptions}
                      milestones={p.milestones.map((m) => ({ id: m.id, label: m.title }))}
                      instructions={p.instructions.map((i) => ({ id: i.id, label: i.taskId ?? i.title ?? i.text.slice(0, 40) }))}
                      changeOrders={p.changeOrders.map((c) => ({ id: c.id, label: c.title }))}
                      documents={docOptions}
                      rfi={{
                        id: r.id,
                        status: r.status,
                        addressedTo: r.addressedTo,
                        assigneeId: r.assigneeId,
                        dueDate: ymd(r.dueDate),
                        workItem: r.workItem,
                        dailyReportNo: r.dailyReportNo,
                        milestoneId: r.milestoneId,
                        siteInstructionId: r.siteInstructionId,
                        changeOrderId: r.changeOrderId,
                        costImpact: r.costImpact,
                        scheduleImpact: r.scheduleImpact,
                        scheduleImpactDays: r.scheduleImpactDays,
                        impactNote: r.impactNote,
                        canRespond: verdict.ok,
                        canClose: canCloseRfi(r, actor),
                        canCancel: canCancelRfi(r, actor),
                        canManage: canManageRfi(actor),
                        documentId: r.documentId,
                      }}
                    />
                  </div>
                );
              })}
              {openRfis.length === 0 && <p className="text-sm text-ink-400">No open RFIs.</p>}
              {closedRfis.length > 0 && (
                <details className="rounded-lg border border-ink-100 p-3">
                  <summary className="cursor-pointer text-sm font-medium text-ink-700">Closed or cancelled ({closedRfis.length})</summary>
                  <ul className="mt-2 space-y-1.5 text-xs text-ink-600">
                    {closedRfis.map((r) => (
                      <li key={r.id}>
                        <strong>{formatRfiNumber(r.number)}</strong> · {r.subject} — {r.status === "CLOSED" ? "closed" : "cancelled"}
                        {r.responseText && <> · answer: {r.responseText.slice(0, 120)}</>}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {canRaise && (
                <details className="rounded-lg border border-dashed border-ink-200 p-3">
                  <summary className="cursor-pointer text-sm font-medium text-ink-700">+ New RFI</summary>
                  <div className="mt-3">
                    <NewRfiForm
                      projectId={p.id}
                      canSendToClient={canRaiseRfi(user.role, "CLIENT")}
                      staff={staffOptions}
                      milestones={p.milestones.map((m) => ({ id: m.id, label: m.title }))}
                      documents={docOptions}
                    />
                  </div>
                </details>
              )}
            </CardBody>
          </Card>
        </section>

        {/* ---------- Additional work requested by the client ---------- */}
        <section id="additional-work" className="scroll-mt-14">
          <Card>
            <CardHeader
              title={`Additional work requests (${p.workRequests.filter((w) => w.status === "REQUESTED" || w.status === "UNDER_REVIEW").length} open)`}
              subtitle="Requests from the client's portal. They carry no price and never change the contract value — send one on as a change order, or decline it with a reason."
            />
            <CardBody className="space-y-3">
              {p.workRequests.map((w) => (
                <div key={w.id} className="rounded-lg border border-ink-100 p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-ink-900">
                      {formatWorkRequestNumber(w.number)} · {w.title}
                    </span>
                    <span
                      className={`rounded-sm px-2 py-0.5 text-xs font-semibold ${
                        w.status === "REQUESTED"
                          ? "bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300"
                          : w.status === "UNDER_REVIEW"
                            ? "bg-blue-100 text-blue-900 dark:bg-blue-950/60 dark:text-blue-300"
                            : w.status === "CONVERTED"
                              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                              : "bg-ink-200 text-ink-700"
                      }`}
                    >
                      {w.status === "REQUESTED"
                        ? "New request"
                        : w.status === "UNDER_REVIEW"
                          ? "Under review"
                          : w.status === "CONVERTED"
                            ? "Sent as change order"
                            : w.status === "DECLINED"
                              ? "Declined"
                              : "Withdrawn by client"}
                    </span>
                  </div>
                  <p className="mt-1 whitespace-pre-line text-xs text-ink-700">{w.description}</p>
                  {Array.isArray(w.photos) && (w.photos as string[]).length > 0 && (
                    <div className="mt-2">
                      <PhotoThumbnails photos={(w.photos as string[]).map((src) => ({ src, label: formatWorkRequestNumber(w.number) }))} />
                    </div>
                  )}
                  <div className="mt-1.5 grid gap-x-6 gap-y-0.5 text-xs text-ink-500 sm:grid-cols-2">
                    <div>
                      Requested by {w.requestedBy.name} · {fmtDateTime(w.createdAt)}
                    </div>
                    {w.reviewedByName && (
                      <div>
                        Handled by {w.reviewedByName}
                        {w.reviewedAt && ` · ${fmtDateTime(w.reviewedAt)}`}
                      </div>
                    )}
                    {showMoney && (w.estimatedCost != null || w.estimatedDays != null) && (
                      <div>
                        Estimate (internal):{" "}
                        {w.estimatedCost != null ? <Fig>{php(w.estimatedCost.toString())}</Fig> : "cost not set"}
                        {w.estimatedDays != null && <> · {w.estimatedDays} day(s)</>}
                      </div>
                    )}
                    {w.changeOrder && (
                      <div>
                        Change order: {w.changeOrder.title} ({CO_LABEL[w.changeOrder.status] ?? w.changeOrder.status.toLowerCase()}) — see Changes
                      </div>
                    )}
                  </div>
                  {w.internalNote && <p className="mt-1.5 rounded-sm bg-ink-100 px-2 py-1 text-xs text-ink-600">Internal note: {w.internalNote}</p>}
                  {w.declineReason && <p className="mt-1.5 text-xs text-ink-600">Reason given to the client: {w.declineReason}</p>}
                  {canReviewWorkRequest(user.role) && (
                    <WorkRequestControls
                      wr={{
                        id: w.id,
                        status: w.status,
                        title: w.title,
                        description: w.description,
                        estimatedCost: w.estimatedCost != null ? Number(w.estimatedCost) : null,
                        estimatedDays: w.estimatedDays,
                        internalNote: w.internalNote,
                      }}
                    />
                  )}
                </div>
              ))}
              {p.workRequests.length === 0 && (
                <p className="text-sm text-ink-400">No additional work requested yet. Clients can send requests from their portal.</p>
              )}
            </CardBody>
          </Card>
        </section>

        <div id="commercial" className="grid scroll-mt-14 gap-6 lg:grid-cols-2 [&>*]:min-w-0">
          {showMoney && (
            <Card>
              <CardHeader title="Payment terms & billing" subtitle="Downpayment, milestones, retention — paid = cash received" />
              <Table>
                <thead>
                  <tr>
                    <Th>Term</Th>
                    <Th className="text-right">Amount</Th>
                    <Th className="text-right">Paid</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {termRows.map(({ t, paid, state }) => {
                    return (
                      <tr key={t.id}>
                        <Td>
                          {t.label}
                          {t.dueCondition && <div className="text-xs text-ink-400">{t.dueCondition}</div>}
                        </Td>
                        <Td className="text-right tabular-nums">
                          <Fig>{php(t.amount.toString())}</Fig>
                        </Td>
                        <Td className="text-right tabular-nums text-emerald-700">
                          <Fig>{php(paid)}</Fig>
                        </Td>
                        <Td>
                          <span className={`inline-block rounded-sm px-2 py-0.5 text-xs font-semibold ${BILLING_TONE[state.state]}`}>
                            {BILLING_LABEL[state.state]}
                            {state.daysOverdue ? ` · ${state.daysOverdue}d` : ""}
                          </span>
                          <div className="mt-1 space-y-0.5 text-[11px] text-ink-500">
                            {t.invoicedAt && (
                              <div>
                                Invoice {t.invoiceNo ? `${t.invoiceNo} · ` : ""}
                                {fmtDate(t.invoicedAt)}
                                {state.certified && t.certifiedAt ? ` · certified ${fmtDate(t.certifiedAt)}` : ""}
                              </div>
                            )}
                            <div>{t.dueDate ? `Due ${fmtDate(t.dueDate)}` : t.invoicedAt ? "No due date entered" : ""}</div>
                            {t.type === "RETENTION" && t.retentionReleaseDate && <div>Release {fmtDate(t.retentionReleaseDate)}</div>}
                          </div>
                          {canRecordPayment && (
                            <BillingDetailsButton
                              term={{
                                id: t.id,
                                type: t.type,
                                invoiceNo: t.invoiceNo,
                                invoicedAt: ymd(t.invoicedAt),
                                certifiedAt: ymd(t.certifiedAt),
                                dueDate: ymd(t.dueDate),
                                retentionReleaseDate: ymd(t.retentionReleaseDate),
                              }}
                            />
                          )}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
              {canRecordPayment && (
                <CardBody className="border-t border-ink-100">
                  <details>
                    <summary className="cursor-pointer text-sm font-medium text-ink-700">+ Record payment received</summary>
                    <div className="mt-3">
                      <PaymentForm
                        projectId={p.id}
                        terms={p.paymentTerms.map((t) => ({
                          id: t.id,
                          label: t.label,
                          amount: Number(t.amount),
                        }))}
                      />
                    </div>
                  </details>
                  <PaymentList
                    canEdit={canRecordPayment}
                    payments={p.payments.map((pay) => ({
                      id: pay.id,
                      amount: Number(pay.amount),
                      dateReceived: pay.dateReceived.toISOString().slice(0, 10),
                      method: pay.method,
                      reference: pay.reference,
                      recordedByName: pay.recordedBy.name,
                      attachments: (pay.attachments as string[] | null) ?? [],
                    }))}
                  />
                </CardBody>
              )}
            </Card>
          )}

          <Card>
            <CardHeader
              title={`Change orders (${p.changeOrders.length})`}
              subtitle="Client approves/rejects in their portal — timestamped record"
            />
            <CardBody className="space-y-3">
              <div id="changes" className="scroll-mt-14" />
              {p.changeOrders.map((co) => (
                <div key={co.id} className="rounded-lg border border-ink-100 p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-ink-900">{co.title}</span>
                    <span className={`rounded-sm px-2 py-0.5 text-xs font-semibold ${CO_TONE[co.status]}`}>{CHANGE_ORDER_LABEL[co.status]}</span>
                  </div>
                  <p className="mt-1 text-xs text-ink-500">{co.description}</p>
                  {co.reason && <p className="mt-1 text-xs text-ink-500">Why: {co.reason}</p>}
                  <p className="mt-1 text-xs text-ink-600">
                    {showMoney &&
                      (co.status === "POTENTIAL" ? (
                        <>
                          {co.estimatedCost != null ? (
                            <>
                              Estimate <Fig>{php(co.estimatedCost.toString())}</Fig>
                            </>
                          ) : (
                            "Not priced yet"
                          )}{" "}
                          (internal — not in contract value) ·{" "}
                        </>
                      ) : (
                        <>
                          Cost impact <Fig>{php(co.costImpact.toString())}</Fig>
                          {co.status === "PENDING_CLIENT" && " (pending — not in contract value)"}
                          {co.status === "REJECTED" && " (rejected — not in contract value)"}
                          {co.status === "WITHDRAWN" && " (withdrawn — not in contract value)"} ·{" "}
                        </>
                      ))}
                    {co.timeImpactDays} day(s)
                    {co.clientResponseAt && ` · responded ${fmtDateTime(co.clientResponseAt)}`}
                  </p>
                  {showMoney && co.status === "APPROVED" && co.contractBefore != null && co.contractAfter != null && (
                    <p className="mt-1 text-[11px] text-ink-500">
                      Contract value <Fig>{php(co.contractBefore.toString())}</Fig> → <Fig>{php(co.contractAfter.toString())}</Fig>
                      {co.incorporatedAt && ` on ${fmtDate(co.incorporatedAt)}`}
                    </p>
                  )}
                  {co.status === "WITHDRAWN" && co.withdrawnReason && (
                    <p className="mt-1 text-[11px] text-ink-500">
                      Withdrawn{co.withdrawnAt ? ` ${fmtDate(co.withdrawnAt)}` : ""}: {co.withdrawnReason}
                    </p>
                  )}
                  {user.role === "OWNER" && co.status === "PENDING_CLIENT" && (
                    <div className="mt-2 flex items-center gap-3">
                      <EditChangeOrderButton
                        co={{
                          id: co.id,
                          title: co.title,
                          description: co.description,
                          costImpact: Number(co.costImpact),
                          timeImpactDays: co.timeImpactDays,
                        }}
                      />
                      <DeleteChangeOrderButton changeOrderId={co.id} />
                    </div>
                  )}
                  {canCreateCO && (
                    <ChangeLifecycleControls
                      co={{
                        id: co.id,
                        status: co.status,
                        title: co.title,
                        description: co.description,
                        estimatedCost: co.estimatedCost != null ? Number(co.estimatedCost) : null,
                        timeImpactDays: co.timeImpactDays,
                        reason: co.reason,
                      }}
                    />
                  )}
                </div>
              ))}
              {p.changeOrders.length === 0 && <p className="text-sm text-ink-400">No change orders.</p>}
              {canCreateCO && (
                <>
                  <details className="rounded-lg border border-dashed border-ink-200 p-3">
                    <summary className="cursor-pointer text-sm font-medium text-ink-700">+ New change order (sent to the client now)</summary>
                    <div className="mt-3">
                      <ChangeOrderForm projectId={p.id} />
                    </div>
                  </details>
                  <details className="rounded-lg border border-dashed border-ink-200 p-3">
                    <summary className="cursor-pointer text-sm font-medium text-ink-700">+ Log a potential change (internal, not sent)</summary>
                    <div className="mt-3">
                      <PotentialChangeForm projectId={p.id} />
                    </div>
                  </details>
                </>
              )}
            </CardBody>
          </Card>
        </div>

        {showMoney && (
          <section id="commercial-summary" className="scroll-mt-14 grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
            <Card>
              <CardHeader title="Contract reconciliation" subtitle="Only approved change orders are in the contract value" />
              <CardBody className="space-y-2 text-sm">
                <div className="flex justify-between gap-3">
                  <span className="text-ink-600">Original contract (derived)</span>
                  <span className="tabular-nums"><Fig>{php(reconciliation.original)}</Fig></span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-ink-600">+ Approved change orders ({reconciliation.approvedCount})</span>
                  <span className="tabular-nums"><Fig>{php(reconciliation.approvedTotal)}</Fig></span>
                </div>
                <div className="flex justify-between gap-3 border-t border-ink-100 pt-2 font-semibold text-ink-900">
                  <span>= Approved contract value</span>
                  <span className="tabular-nums"><Fig>{php(reconciliation.current)}</Fig></span>
                </div>
                <div className="flex justify-between gap-3 text-xs text-ink-500">
                  <span>Awaiting client ({reconciliation.pendingCount}) — not included</span>
                  <span className="tabular-nums"><Fig>{php(reconciliation.pendingTotal)}</Fig></span>
                </div>
                <div className="flex justify-between gap-3 text-xs text-ink-500">
                  <span>
                    Potential ({reconciliation.potentialCount}) — not included
                    {reconciliation.potentialUnpriced > 0 && `, ${reconciliation.potentialUnpriced} not priced`}
                  </span>
                  <span className="tabular-nums"><Fig>{php(reconciliation.potentialPricedTotal)}</Fig></span>
                </div>
                {reconciliation.inconsistent && (
                  <p className="rounded-sm bg-red-50 px-2 py-1 text-xs text-red-800 dark:bg-red-950/40 dark:text-red-300">
                    ▲ Approved change orders add up to more than the current contract value — check the contract value.
                  </p>
                )}
                <p className="border-t border-ink-100 pt-2 text-xs text-ink-600">
                  {coverage.status === "none" && "No billing terms are set up yet."}
                  {coverage.status === "complete" && "✓ Billing terms add up to the contract value."}
                  {coverage.status === "under" && (
                    <>
                      ● Billing terms cover <Fig>{php(coverage.termsTotal)}</Fig> — <Fig>{php(coverage.difference)}</Fig> of the contract isn’t scheduled for billing yet.
                    </>
                  )}
                  {coverage.status === "over" && (
                    <>
                      ▲ Billing terms total <Fig>{php(coverage.termsTotal)}</Fig>, which is <Fig>{php(Math.abs(coverage.difference))}</Fig> more than the contract value.
                    </>
                  )}
                </p>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Receivables & retention" subtitle="An invoice is not cash — only recorded payments reduce what is owed" />
              <CardBody className="space-y-3 text-sm">
                <div className="space-y-1">
                  {(
                    [
                      ["Overdue", aging.overdueTotal, "text-red-700 dark:text-red-300"],
                      ["  1–30 days late", aging.days1to30, ""],
                      ["  31–60 days late", aging.days31to60, ""],
                      ["  61–90 days late", aging.days61to90, ""],
                      ["  over 90 days late", aging.days90plus, ""],
                      ["Billed, not yet due", aging.notYetDue, ""],
                      ["Billed, no due date entered", aging.noDueDate, "text-amber-800 dark:text-amber-300"],
                      ["Due, not yet invoiced", aging.notInvoiced, ""],
                    ] as const
                  )
                    .filter(([label, amount]) => amount > 0 || label === "Overdue")
                    .map(([label, amount, tone]) => (
                      <div key={label} className={`flex justify-between gap-3 ${tone}`}>
                        <span className="whitespace-pre text-ink-700">{label}</span>
                        <span className="tabular-nums"><Fig>{php(amount)}</Fig></span>
                      </div>
                    ))}
                </div>
                {aging.noDueDate > 0 && (
                  <p className="text-xs text-amber-800 dark:text-amber-300">
                    ● Some billed amounts have no due date, so their lateness can’t be measured — add due dates under “Billing details”.
                  </p>
                )}
                <div className="border-t border-ink-100 pt-2">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-500">Retention held</p>
                  {retentionRows.length === 0 ? (
                    <p className="text-xs text-ink-500">No retention outstanding.</p>
                  ) : (
                    <ul className="space-y-1 text-xs">
                      {retentionRows.map((r) => (
                        <li key={r.id} className="flex justify-between gap-3">
                          <span className={r.overdue ? "text-red-700 dark:text-red-300" : "text-ink-700"}>
                            {r.label} ·{" "}
                            {r.releaseDate
                              ? r.overdue
                                ? `release date passed ${Math.abs(r.daysUntil ?? 0)}d ago`
                                : `release ${fmtDate(r.releaseDate)}`
                              : "no release date recorded"}
                          </span>
                          <span className="tabular-nums"><Fig>{php(r.outstanding)}</Fig></span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </CardBody>
            </Card>

            {showMargin ? (
              <Card>
                <CardHeader title="Commitments" subtitle="A requisition is a request. Only approved ones are committed cost" />
                <CardBody className="space-y-2 text-sm">
                  <div className="flex justify-between gap-3 text-ink-500">
                    <span>Awaiting approval ({commitments.pending.count}) — not committed</span>
                    <span className="tabular-nums"><Fig>{php(commitments.pending.amount)}</Fig></span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-ink-700">Approved, no PO yet ({commitments.approved.count}) — at estimate</span>
                    <span className="tabular-nums"><Fig>{php(commitments.approved.amount)}</Fig></span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-ink-700">PO issued ({commitments.ordered.count}) — at PO amount</span>
                    <span className="tabular-nums"><Fig>{php(commitments.ordered.amount)}</Fig></span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-ink-700">Delivered ({commitments.delivered.count})</span>
                    <span className="tabular-nums"><Fig>{php(commitments.delivered.amount)}</Fig></span>
                  </div>
                  <div className="flex justify-between gap-3 border-t border-ink-100 pt-2">
                    <span className="text-ink-700">Materials &amp; other committed</span>
                    <span className="tabular-nums"><Fig>{php(commitments.committedTotal)}</Fig></span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-ink-700">+ Payroll (approved / paid runs)</span>
                    <span className="tabular-nums"><Fig>{php(laborCost)}</Fig></span>
                  </div>
                  <div className="flex justify-between gap-3 border-t border-ink-100 pt-2 font-semibold text-ink-900">
                    <span>= Committed cost</span>
                    <span className="tabular-nums"><Fig>{php(commitments.committedTotal + laborCost)}</Fig></span>
                  </div>
                  {commitments.approved.withoutEstimate > 0 && (
                    <p className="text-xs text-amber-800 dark:text-amber-300">
                      ● {commitments.approved.withoutEstimate} approved requisition{commitments.approved.withoutEstimate === 1 ? " has" : "s have"} no estimate, so it counts as ₱0 until a PO or estimate is entered.
                    </p>
                  )}
                  {Math.abs(commitments.committedTotal + laborCost - committed) > 0.5 && (
                    <p className="text-xs text-red-700 dark:text-red-300">▲ This doesn’t match the Committed cost figure above — please report it.</p>
                  )}
                </CardBody>
              </Card>
            ) : (
              <div />
            )}
          </section>
        )}

        {/* Portal access — Owner only (account creation rule) */}
        {user.role === "OWNER" && (
          <Card>
            <CardHeader
              title="Client portal access"
              subtitle={`Login for ${p.client.name} — one account covers all their projects`}
            />
            <CardBody className="space-y-3">
              {p.client.users.map((u) => (
                <div key={u.id} className="flex items-center justify-between rounded-lg border border-ink-100 px-3 py-2 text-sm">
                  <div>
                    <span className="font-medium text-ink-800">{u.name}</span>
                    <span className="ml-2 text-xs text-ink-400">{u.email}</span>
                    {u.mustChangePassword && u.active && (
                      <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">
                        temp password — not yet changed
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge value={u.active ? "ACTIVE" : "NOT_ACTIVE"} label={u.active ? "Active" : "Deactivated"} />
                    <AccountToggleButton userId={u.id} name={u.name} active={u.active} />
                  </div>
                </div>
              ))}
              {p.client.users.length === 0 && (
                <p className="text-sm text-ink-400">
                  No portal login yet — create one so the client can follow progress and approve change orders online.
                </p>
              )}
              <details className="rounded-lg border border-dashed border-ink-200 p-3" open={p.client.users.length === 0}>
                <summary className="cursor-pointer text-sm font-medium text-ink-700">+ Create client login</summary>
                <div className="mt-3">
                  <CreatePortalAccessForm projectId={p.id} />
                </div>
              </details>
            </CardBody>
          </Card>
        )}

        <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
          <Card>
            <CardHeader
              title={`Progress timeline (${p.progressEntries.length})`}
              subtitle="Every entry timestamped and attributed. Only approved entries count as verified and appear in the client portal."
              action={
                <a
                  href={`/api/projects/${p.id}/accomplishment-export`}
                  className="rounded-lg border border-ink-200 px-3 py-1.5 text-xs font-medium text-ink-600 hover:bg-ink-50"
                >
                  Export accomplishment (CSV)
                </a>
              }
            />
            <CardBody className="space-y-4">
              <div id="progress" className="scroll-mt-14" />
              <div className="flex flex-col items-center gap-4 rounded-lg bg-ink-50 p-4 sm:flex-row sm:items-start">
                <AccomplishmentRadial items={workItemStatuses} />
                <div className="w-full flex-1">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">
                    Weighted accomplishment by work item (approved)
                  </p>
                  <WorkItemWeightBars items={workItemStatuses} />
                </div>
              </div>
              {canProgress && <ProgressForm projectId={p.id} />}
              {!canReview && canProgress && (
                <p className="text-xs text-ink-500">Entries you submit are reviewed by the PM or Owner before they count as verified progress.</p>
              )}
              <ol className="space-y-2">
                {p.progressEntries.map((e) => {
                  const canEditEntry =
                    canReview || (e.submittedById === user.id && e.reviewStatus !== "APPROVED");
                  return (
                    <li key={e.id} className="rounded-lg border border-ink-100 p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-1">
                        <span className="flex items-center gap-2">
                          <span className="font-semibold text-brand-600">{Number(e.pctComplete).toFixed(0)}%</span>
                          <span className={`rounded-sm px-1.5 py-0.5 text-[11px] font-semibold ${REVIEW_TONE[e.reviewStatus]}`}>
                            {REVIEW_LABEL[e.reviewStatus]}
                          </span>
                        </span>
                        <span className="text-xs text-ink-400">
                          {fmtDateTime(e.createdAt)} · {e.submittedBy.name}
                          {e.editedAt && " · edited"}
                        </span>
                      </div>
                      {e.workItem && (
                        <div className="font-medium text-ink-800">
                          {e.workItem}
                          {e.weight != null && (
                            <span className="ml-1.5 text-xs font-normal text-ink-400">({Number(e.weight).toFixed(0)}% weight)</span>
                          )}
                        </div>
                      )}
                      {e.notes && <p className="text-xs text-ink-500">{e.notes}</p>}
                      {e.reviewStatus === "QUERIED" && e.reviewNote && (
                        <p className="mt-1 rounded-sm bg-red-50 px-2 py-1 text-xs text-red-800 dark:bg-red-950/40 dark:text-red-300">
                          Query: {e.reviewNote}
                          {e.submittedById === user.id && " — edit the entry to resubmit it for review."}
                        </p>
                      )}
                      {e.reviewStatus === "APPROVED" && e.reviewedById && e.reviewedById !== e.submittedById && (
                        <p className="mt-1 text-[11px] text-ink-400">
                          Approved by {reviewerName.get(e.reviewedById) ?? "—"}
                          {e.reviewedAt && ` · ${fmtDateTime(e.reviewedAt)}`}
                        </p>
                      )}
                      {Array.isArray(e.photos) && (e.photos as string[]).length > 0 && (
                        <div className="mt-2">
                          <PhotoThumbnails photos={(e.photos as string[]).map((src) => ({ src, label: fmtDateTime(e.createdAt) }))} />
                        </div>
                      )}
                      {e.reviewStatus === "SUBMITTED" && canReview && <ProgressReviewControls entryId={e.id} />}
                      {canEditEntry && (
                        <EditProgressEntryButton
                          entry={{
                            id: e.id,
                            workItem: e.workItem,
                            weight: e.weight != null ? Number(e.weight) : null,
                            color: e.color,
                            pctComplete: Number(e.pctComplete),
                            notes: e.notes,
                          }}
                        />
                      )}
                    </li>
                  );
                })}
                {p.progressEntries.length === 0 && <p className="text-sm text-ink-400">No progress entries yet.</p>}
              </ol>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={`Requisitions (${p.requisitions.length})`} subtitle="A requisition is a request — only approved ones count as committed cost" />
            <CardBody className="space-y-2">
              <div id="requisitions" className="scroll-mt-14" />
              {p.requisitions.map((r) => (
                <Link
                  key={r.id}
                  href={`/requisitions/${r.id}`}
                  className="flex items-center justify-between rounded-lg border border-ink-100 p-3 text-sm hover:bg-ink-50"
                >
                  <div>
                    <div className="font-medium text-ink-800">
                      {fmtDateTime(r.submittedAt)} — {r.submittedBy.name}
                    </div>
                    {showMoney && r.estimatedCost && (
                      <div className="text-xs text-ink-500">
                        <Fig>{php(r.estimatedCost.toString())}</Fig>
                      </div>
                    )}
                  </div>
                  <Badge value={r.status} />
                </Link>
              ))}
              {p.requisitions.length === 0 && <p className="text-sm text-ink-400">No requisitions for this project.</p>}
            </CardBody>
          </Card>
        </div>

        {/* ---------- Quality & safety ---------- */}
        <section id="quality" className="scroll-mt-14">
          <Card>
            <CardHeader
              title={`Quality & safety (${openFindings.length} open)`}
              subtitle="Defects, punch items, inspection findings, safety observations and incidents. Each is fixed by one person and reviewed by another before it closes. Incidents are visible only to the Owner, PM, the reporter and the assignee."
            />
            <CardBody className="space-y-3">
              {hiddenFindingCount > 0 && canManageQuality === false && (
                <p className="text-xs text-ink-500">Some restricted reports aren’t shown to you.</p>
              )}
              {openFindings.map((f) => {
                const due = findingDueState(f, now);
                const sevTone =
                  f.severity === "CRITICAL" || f.severity === "HIGH"
                    ? "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300"
                    : f.severity === "MEDIUM"
                      ? "bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300"
                      : "bg-ink-200 text-ink-700";
                return (
                  <div key={f.id} className="rounded-lg border border-ink-100 p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-ink-900">
                        {formatFindingNumber(f.number)} · {f.title}
                      </span>
                      <span className="flex flex-wrap items-center gap-1.5 text-xs">
                        <span className={`rounded-sm px-1.5 py-0.5 font-semibold ${sevTone}`}>{f.severity === "CRITICAL" || f.severity === "HIGH" ? "▲ " : ""}{f.severity.charAt(0) + f.severity.slice(1).toLowerCase()}</span>
                        <span className="rounded-sm bg-ink-200 px-1.5 py-0.5 font-semibold text-ink-700">{FINDING_TYPE_LABEL[f.type]}</span>
                        {f.restricted && <span className="rounded-sm bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-900 dark:bg-amber-950/60 dark:text-amber-300">Restricted</span>}
                        <span className="rounded-sm bg-ink-200 px-1.5 py-0.5 font-semibold text-ink-700">
                          {f.status === "OPEN" ? "Open" : f.status === "IN_PROGRESS" ? "In progress" : "Awaiting review"}
                        </span>
                        {due === "overdue" && <span className="rounded-sm bg-red-100 px-1.5 py-0.5 font-semibold text-red-800 dark:bg-red-950/60 dark:text-red-300">▲ Overdue</span>}
                        {due === "due-soon" && <span className="rounded-sm bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-900 dark:bg-amber-950/60 dark:text-amber-300">● Due soon</span>}
                      </span>
                    </div>
                    <p className="mt-1 whitespace-pre-line text-xs text-ink-700">{f.description}</p>
                    {Array.isArray(f.photos) && (f.photos as string[]).length > 0 && (
                      <div className="mt-2">
                        <PhotoThumbnails photos={(f.photos as string[]).map((src) => ({ src, label: formatFindingNumber(f.number) }))} />
                      </div>
                    )}
                    <div className="mt-1.5 grid gap-x-6 gap-y-0.5 text-xs text-ink-500 sm:grid-cols-2">
                      <div>
                        Raised by {f.raisedBy.name} · {fmtDateTime(f.createdAt)}
                      </div>
                      <div>
                        Fixed by: {f.owner?.name ?? "not assigned"}
                        {f.dueDate && <> · fix by {fmtDate(f.dueDate)}</>}
                      </div>
                      {f.location && <div>Location: {f.location}</div>}
                      {f.workItem && <div>Work item: {f.workItem}</div>}
                    </div>
                    {f.reviewNote && f.status !== "CLOSED" && (
                      <p className="mt-1.5 rounded-sm bg-red-50 px-2 py-1 text-xs text-red-800 dark:bg-red-950/40 dark:text-red-300">Reviewer note: {f.reviewNote}</p>
                    )}
                    {f.closureNote && f.status === "READY_FOR_REVIEW" && (
                      <div className="mt-1.5 rounded-sm border border-emerald-200 bg-emerald-50 p-2 text-xs text-ink-800 dark:border-emerald-900 dark:bg-emerald-950/30">
                        <div className="font-semibold">Fix submitted {f.closureSubmittedAt ? fmtDateTime(f.closureSubmittedAt) : ""}</div>
                        <p className="mt-0.5 whitespace-pre-line">{f.closureNote}</p>
                        {Array.isArray(f.closurePhotos) && (f.closurePhotos as string[]).length > 0 && (
                          <div className="mt-1.5">
                            <PhotoThumbnails photos={(f.closurePhotos as string[]).map((src) => ({ src, label: `${formatFindingNumber(f.number)} fix` }))} />
                          </div>
                        )}
                      </div>
                    )}
                    <FindingControls
                      staff={staffOptions}
                      f={{
                        id: f.id,
                        status: f.status,
                        severity: f.severity,
                        ownerId: f.ownerId,
                        dueDate: ymd(f.dueDate),
                        canWork: canWorkFinding(f, viewerRef),
                        canClose: canCloseFinding(f, viewerRef),
                        canSendBack: canSendBackFinding(f, viewerRef),
                        canReopen: canReopenFinding(f, viewerRef),
                        canEdit: canManageQuality,
                      }}
                    />
                  </div>
                );
              })}
              {openFindings.length === 0 && <p className="text-sm text-ink-400">No open findings.</p>}
              {closedFindings.length > 0 && (
                <details className="rounded-lg border border-ink-100 p-3">
                  <summary className="cursor-pointer text-sm font-medium text-ink-700">Closed ({closedFindings.length})</summary>
                  <ul className="mt-2 space-y-2 text-xs text-ink-600">
                    {closedFindings.map((f) => (
                      <li key={f.id}>
                        <strong>{formatFindingNumber(f.number)}</strong> · {f.title} — closed {f.closedAt ? fmtDate(f.closedAt) : ""}
                        {f.closedByName ? ` by ${f.closedByName}` : ""}
                        {f.closureNote && <> · fix: {f.closureNote.slice(0, 140)}</>}
                        <FindingControls
                          staff={staffOptions}
                          f={{ id: f.id, status: f.status, severity: f.severity, ownerId: f.ownerId, dueDate: ymd(f.dueDate), canWork: false, canClose: false, canSendBack: false, canReopen: canReopenFinding(f, viewerRef), canEdit: false }}
                        />
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {canRaiseFinding(user.role) && (
                <details className="rounded-lg border border-dashed border-ink-200 p-3">
                  <summary className="cursor-pointer text-sm font-medium text-ink-700">+ Record a finding</summary>
                  <div className="mt-3">
                    <NewFindingForm projectId={p.id} staff={staffOptions} />
                  </div>
                </details>
              )}
            </CardBody>
          </Card>
        </section>

        {/* ---------- Closeout ---------- */}
        <section id="closeout" className="scroll-mt-14">
          <Card>
            <CardHeader
              title={`Closeout checklist${closeout.total ? ` (${closeout.requiredDone}/${closeout.requiredTotal} required done)` : ""}`}
              subtitle="What must be finished before turnover. A project is ready only when every required item is done and no defect or punch item is open."
            />
            <CardBody className="space-y-3">
              {closeout.total > 0 && (
                <p className={`text-sm ${closeout.ready ? "text-emerald-800 dark:text-emerald-300" : "text-ink-700"}`}>
                  {closeout.ready ? "✓ Ready for turnover." : `Not ready yet — ${closeout.blockers.join("; ")}.`}
                </p>
              )}
              <CloseoutChecklist
                projectId={p.id}
                canEdit={canManageQuality}
                items={p.closeoutItems.map((i) => ({
                  id: i.id,
                  title: i.title,
                  category: i.category,
                  required: i.required,
                  done: i.done,
                  doneByName: i.doneByName,
                  doneAt: i.doneAt ? fmtDate(i.doneAt) : null,
                  note: i.note,
                }))}
              />
            </CardBody>
          </Card>
        </section>

        {/* ---------- Documents ---------- */}
        <section id="documents" className="scroll-mt-14">
          <Card>
            <CardHeader
              title={`Documents & drawings (${p.documents.length})`}
              subtitle="Each document keeps every revision — a new one supersedes the current, nothing is overwritten. Files stay where you keep them (link) or are uploaded small (3 MB max)."
            />
            <CardBody className="space-y-3">
              {p.documents.map((d) => {
                const cur = currentRevision(d.revisions);
                const older = d.revisions.filter((r) => r.id !== cur?.id);
                return (
                  <div key={d.id} className="rounded-lg border border-ink-100 p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-ink-900">
                        {d.docNo && <span className="mr-1.5 text-ink-500">{d.docNo}</span>}
                        {d.title}
                      </span>
                      <span className="flex items-center gap-1.5 text-xs">
                        <span className="rounded-sm bg-ink-200 px-1.5 py-0.5 font-semibold text-ink-700">{d.category.charAt(0) + d.category.slice(1).toLowerCase()}</span>
                        {d.visibleToClient && <span className="rounded-sm bg-emerald-100 px-1.5 py-0.5 font-semibold text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">Shared with client</span>}
                      </span>
                    </div>
                    {cur ? (
                      <p className="mt-1 text-xs text-ink-700">
                        Current: <strong>revision {cur.revision}</strong> ·{" "}
                        <a href={cur.url} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-600 hover:underline">
                          {cur.fileName ?? (cur.isExternal ? "open link" : "open file")} ↗
                        </a>{" "}
                        · {cur.uploadedByName}, {fmtDate(cur.createdAt)}
                        {cur.notes && <> — {cur.notes}</>}
                      </p>
                    ) : (
                      <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">No current revision.</p>
                    )}
                    {older.length > 0 && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-xs text-ink-500">Superseded revisions ({older.length})</summary>
                        <ul className="mt-1 space-y-0.5 text-xs text-ink-500">
                          {older.map((r) => (
                            <li key={r.id}>
                              Revision {r.revision} ·{" "}
                              <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline">
                                {r.fileName ?? "open"} ↗
                              </a>{" "}
                              · {r.uploadedByName}, {fmtDate(r.createdAt)}
                              {r.supersededAt && ` · superseded ${fmtDate(r.supersededAt)}`}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                    {canManageQuality && (
                      <DocumentControls id={d.id} visibleToClient={d.visibleToClient} isOwner={isOwnerUser} suggestedRevision={nextRevisionLabel(d.revisions.map((r) => r.revision))} />
                    )}
                  </div>
                );
              })}
              {p.documents.length === 0 && <p className="text-sm text-ink-400">No documents registered yet.</p>}
              {canManageQuality && (
                <details className="rounded-lg border border-dashed border-ink-200 p-3">
                  <summary className="cursor-pointer text-sm font-medium text-ink-700">+ Add a document</summary>
                  <div className="mt-3">
                    <AddDocumentForm projectId={p.id} />
                  </div>
                </details>
              )}
            </CardBody>
          </Card>
        </section>

        <Card>
          <CardHeader
            title={`Daily construction reports (${dailyReports.length})`}
            subtitle={`End-of-day site record — visible reports also appear in the client portal. Download the PDF to keep a copy; reports auto-delete ${DAILY_REPORT_LIFETIME_DAYS} days after posting (a log line stays in the activity feed).`}
          />
          <CardBody className="space-y-3">
            <div id="reports" className="scroll-mt-14" />
            {canProgress && (
              <details className="rounded-lg border border-dashed border-ink-200 p-3">
                <summary className="cursor-pointer text-sm font-medium text-ink-700">+ New daily report</summary>
                <div className="mt-3">
                  <DailyReportForm projectId={p.id} />
                </div>
              </details>
            )}
            {dailyReports.map((r) => (
              <DailyReportCard
                key={r.id}
                report={r}
                canEdit={["OWNER", "PM"].includes(user.role) || r.submittedById === user.id}
                canDelete={user.role === "OWNER"}
              />
            ))}
            {dailyReports.length === 0 && <p className="text-sm text-ink-400">No daily reports posted yet.</p>}
          </CardBody>
        </Card>
      </div>
    </FigureVisibilityProvider>
  );
}
