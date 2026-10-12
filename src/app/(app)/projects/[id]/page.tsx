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
import { Fig, FigureToggle, FigureVisibilityProvider } from "@/components/figure-visibility";
import { ActivityFeed, ProgressReviewControls, ProjectSectionNav, type ActivityRow } from "@/components/project-overview";

export const dynamic = "force-dynamic";

const REVIEW_LABEL = { SUBMITTED: "Awaiting review", QUERIED: "Queried", APPROVED: "Approved" } as const;
const REVIEW_TONE = {
  SUBMITTED: "bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300",
  QUERIED: "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300",
  APPROVED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
} as const;
const CO_LABEL: Record<string, string> = { PENDING_CLIENT: "awaiting client", APPROVED: "approved", REJECTED: "rejected" };

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
  const committed =
    laborCost +
    p.requisitions
      .filter((r) => ["APPROVED", "PO_ISSUED", "DELIVERED"].includes(r.status))
      .reduce(
        (s, r) => s + (r.purchaseOrder ? Number(r.purchaseOrder.totalCost) : Number(r.estimatedCost ?? 0)),
        0
      );
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
    { id: "progress", label: "Progress" },
    { id: "reports", label: "Daily reports" },
    { id: "changes", label: "Changes" },
    ...(showMoney ? [{ id: "commercial", label: "Commercial" }] : []),
    { id: "requisitions", label: "Requisitions" },
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

          <div className="grid gap-4 lg:grid-cols-2">
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
            <CardHeader title="Recent site activity" subtitle="Progress, daily reports, changes, requisitions and payments — newest first" />
            <CardBody>
              <ActivityFeed rows={feedRows} />
            </CardBody>
          </Card>
        </section>

        <div id="commercial" className="grid scroll-mt-14 gap-6 lg:grid-cols-2">
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
                  {p.paymentTerms.map((t) => {
                    const paid = t.payments.reduce((s, x) => s + Number(x.amount), 0);
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
                          <Badge value={t.status} />
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
                    <Badge value={co.status} />
                  </div>
                  <p className="mt-1 text-xs text-ink-500">{co.description}</p>
                  <p className="mt-1 text-xs text-ink-600">
                    {showMoney && (
                      <>
                        Cost impact <Fig>{php(co.costImpact.toString())}</Fig>
                        {co.status === "PENDING_CLIENT" && " (pending — not in contract value)"} ·{" "}
                      </>
                    )}
                    {co.timeImpactDays} day(s)
                    {co.clientResponseAt && ` · responded ${fmtDateTime(co.clientResponseAt)}`}
                  </p>
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
                </div>
              ))}
              {p.changeOrders.length === 0 && <p className="text-sm text-ink-400">No change orders.</p>}
              {canCreateCO && (
                <details className="rounded-lg border border-dashed border-ink-200 p-3">
                  <summary className="cursor-pointer text-sm font-medium text-ink-700">+ New change order</summary>
                  <div className="mt-3">
                    <ChangeOrderForm projectId={p.id} />
                  </div>
                </details>
              )}
            </CardBody>
          </Card>
        </div>

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

        <div className="grid gap-6 lg:grid-cols-2">
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
