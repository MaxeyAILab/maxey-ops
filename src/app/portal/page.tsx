import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fmtDate, fmtDateTime, php } from "@/lib/format";
import { Badge, Card, CardBody, CardHeader } from "@/components/ui";
import { ChangeOrderRespond } from "@/components/co-respond";
import { SignOutButton } from "@/components/signout-button";
import { computeWorkItemStatuses } from "@/lib/progress";
import { AccomplishmentRadial, WorkItemWeightBars } from "@/components/charts";
import { DailyReportCard, type DailyReportDisplay } from "@/components/daily-report-actions";
import { DAILY_REPORT_LIFETIME_DAYS } from "@/lib/daily-reports";
import { PhotoThumbnails } from "@/components/photo-viewer";
import { computeMilestoneHealth } from "@/lib/milestones";
import { formatRfiNumber } from "@/lib/rfi";
import { HEALTH_CHIP, HEALTH_ICON } from "@/components/milestone-timeline";
import { ClientRfiRespond } from "@/components/rfi-actions";
import { NewWorkRequestForm, WithdrawWorkRequestButton } from "@/components/work-request-actions";
import { clientStatusLabel, formatWorkRequestNumber, isOpenWorkRequest } from "@/lib/work-requests";

// A client sees a plain status, never internal planning detail like "no baseline".
const CLIENT_HEALTH: Record<string, string> = {
  complete: "Complete",
  "complete-late": "Complete",
  "on-track": "On track",
  watch: "Slightly behind",
  late: "Behind schedule",
  overdue: "Behind schedule",
  blocked: "On hold",
  "no-baseline": "Planned",
  "no-dates": "Planned",
};

export const metadata = { title: "Client Portal" };
export const dynamic = "force-dynamic";

/**
 * Client portal (Spec 6.7/6.8): curated read-only progress + payment status,
 * change-order approval. No internal cost breakdown is exposed — clients see
 * billing terms and their own payments only.
 */
export default async function PortalPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "CLIENT" || !user.clientId) redirect("/dashboard");
  if (user.mustChangePassword) redirect("/change-password"); // temp password issued

  const projects = await prisma.project.findMany({
    where: { clientId: user.clientId },
    include: {
      paymentTerms: { orderBy: { sortOrder: "asc" }, include: { payments: true } },
      // Internal states (potential, withdrawn) are never shown to the client.
      changeOrders: { where: { status: { in: ["PENDING_CLIENT", "APPROVED", "REJECTED"] } }, orderBy: { createdAt: "desc" } },
      // No `take` here — the weighted-accomplishment calc needs each work
      // item's latest visible entry, which the timeline list below caps to
      // the most recent 20 separately, for display only.
      progressEntries: {
        // Clients only ever see reviewed (approved) progress.
        where: { visibleToClient: true, reviewStatus: "APPROVED" },
        orderBy: { createdAt: "desc" },
        include: { submittedBy: { select: { name: true } } },
      },
      dailyReports: {
        where: { visibleToClient: true },
        orderBy: { reportDate: "desc" },
        include: { submittedBy: { select: { name: true } } },
      },
      // Milestones the team chose to share; internal notes are never selected.
      milestones: {
        where: { visibleToClient: true },
        orderBy: { sortOrder: "asc" },
        select: { id: true, title: true, description: true, status: true, baselineFinish: true, forecastFinish: true, actualFinish: true },
      },
      // Only documents the team chose to share, and only their current revision.
      documents: {
        where: { visibleToClient: true },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          title: true,
          docNo: true,
          revisions: { where: { current: true }, select: { revision: true, url: true, fileName: true, createdAt: true }, take: 1 },
        },
      },
      // The client's own additional-work requests. The team's estimate and
      // internal note are never selected — a price only reaches the client as a change order.
      workRequests: {
        orderBy: { number: "desc" },
        select: {
          id: true,
          number: true,
          title: true,
          description: true,
          status: true,
          createdAt: true,
          declineReason: true,
          changeOrder: { select: { title: true, status: true } },
        },
      },
      // Only RFIs addressed to the client — internal ones never leave the staff side.
      rfis: {
        where: { addressedTo: "CLIENT", status: { not: "CANCELLED" } },
        orderBy: { number: "desc" },
        select: {
          id: true,
          number: true,
          subject: true,
          question: true,
          status: true,
          dueDate: true,
          photos: true,
          responseText: true,
          respondedByName: true,
          respondedAt: true,
          createdAt: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="min-h-screen">
      <header className="border-b border-ink-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 text-sm font-black text-white">
              M
            </span>
            <div>
              <div className="text-sm font-bold text-ink-900">Maxey Construction</div>
              <div className="text-[10px] uppercase tracking-wide text-ink-400">Client Portal</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-ink-500 sm:block">{user.name}</span>
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-8 px-4 py-6">
        {projects.length === 0 && (
          <p className="py-16 text-center text-ink-400">No projects on your account yet.</p>
        )}

        {projects.map((p) => {
          const workItemStatuses = computeWorkItemStatuses(p.progressEntries);
          const timelineEntries = p.progressEntries.slice(0, 20);
          const pendingCOs = p.changeOrders.filter((c) => c.status === "PENDING_CLIENT");
          const dailyReports: DailyReportDisplay[] = p.dailyReports.map((r) => ({
            id: r.id,
            reportNo: r.reportNo,
            reportDate: r.reportDate.toISOString().slice(0, 10),
            weather: r.weather,
            workingHours: r.workingHours,
            workProgress: r.workProgress,
            deliveries:
              (r.deliveries as { material: string; qty: string; supplier: string; condition: string }[] | null) ?? [],
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
          return (
            <section key={p.id} className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h1 className="text-xl font-bold text-ink-900">{p.name}</h1>
                  <p className="text-xs text-ink-500">{p.address}</p>
                </div>
                <Badge value={p.status} />
              </div>

              {/* Progress */}
              <Card>
                <CardHeader title="Overall progress" subtitle="Reported from site, weighted by work item" />
                <CardBody>
                  <div className="flex flex-col items-center gap-4 rounded-lg bg-ink-50 p-4 sm:flex-row sm:items-start">
                    <AccomplishmentRadial items={workItemStatuses} />
                    <div className="w-full flex-1">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">
                        Weighted accomplishment by work item
                      </p>
                      <WorkItemWeightBars items={workItemStatuses} />
                    </div>
                  </div>
                </CardBody>
              </Card>

              {p.rfis.some((r) => r.status === "OPEN") && (
                <Card className="border-amber-300">
                  <CardHeader
                    title={`⚠ ${p.rfis.filter((r) => r.status === "OPEN").length} question(s) for you`}
                    subtitle="The project team needs your answer to continue"
                  />
                  <CardBody className="space-y-4">
                    {p.rfis
                      .filter((r) => r.status === "OPEN")
                      .map((r) => (
                        <div key={r.id} className="rounded-lg border border-ink-100 p-4">
                          <div className="font-semibold text-ink-900">
                            {formatRfiNumber(r.number)} · {r.subject}
                          </div>
                          <p className="mt-1 whitespace-pre-line text-sm text-ink-600">{r.question}</p>
                          {Array.isArray(r.photos) && (r.photos as string[]).length > 0 && (
                            <div className="mt-2">
                              <PhotoThumbnails photos={(r.photos as string[]).map((src) => ({ src, label: formatRfiNumber(r.number) }))} />
                            </div>
                          )}
                          <p className="mt-2 text-xs text-ink-500">
                            Asked {fmtDateTime(r.createdAt)}
                            {r.dueDate && ` · please answer by ${fmtDate(r.dueDate)}`}
                          </p>
                          <div className="mt-3">
                            <ClientRfiRespond rfiId={r.id} />
                          </div>
                        </div>
                      ))}
                  </CardBody>
                </Card>
              )}

              {p.milestones.length > 0 && (
                <Card>
                  <CardHeader title="Milestones" subtitle="Where the project is against its plan" />
                  <CardBody className="space-y-2">
                    {p.milestones.map((m) => {
                      const h = computeMilestoneHealth(
                        { status: m.status, baselineFinish: m.baselineFinish, forecastFinish: m.forecastFinish, actualFinish: m.actualFinish },
                        new Date()
                      );
                      const finish = m.status === "COMPLETED" ? m.actualFinish : (m.forecastFinish ?? m.baselineFinish);
                      return (
                        <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ink-100 px-3 py-2 text-sm">
                          <div>
                            <div className="font-medium text-ink-800">{m.title}</div>
                            {m.description && <div className="text-xs text-ink-500">{m.description}</div>}
                            <div className="text-xs text-ink-400">
                              {m.status === "COMPLETED" ? "Completed" : "Expected"} {finish ? fmtDate(finish) : "— date to be confirmed"}
                            </div>
                          </div>
                          <span className={`rounded-sm px-2 py-0.5 text-xs font-semibold ${HEALTH_CHIP[h.health]}`}>
                            {HEALTH_ICON[h.health]} {CLIENT_HEALTH[h.health]}
                          </span>
                        </div>
                      );
                    })}
                  </CardBody>
                </Card>
              )}

              {pendingCOs.length > 0 && (
                <Card className="border-amber-300">
                  <CardHeader
                    title={`⚠ ${pendingCOs.length} change order(s) awaiting your approval`}
                    subtitle="Work cannot proceed on these items until you respond"
                  />
                  <CardBody className="space-y-4">
                    {pendingCOs.map((co) => (
                      <div key={co.id} className="rounded-lg border border-ink-100 p-4">
                        <div className="font-semibold text-ink-900">{co.title}</div>
                        <p className="mt-1 text-sm text-ink-600">{co.description}</p>
                        <p className="mt-2 text-sm font-medium text-ink-800">
                          Additional cost: {php(co.costImpact.toString())} · Schedule impact:{" "}
                          {co.timeImpactDays} day(s)
                        </p>
                        <div className="mt-3">
                          <ChangeOrderRespond changeOrderId={co.id} />
                        </div>
                      </div>
                    ))}
                  </CardBody>
                </Card>
              )}

              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader title="Progress updates" subtitle="Reported from site, timestamped" />
                  <CardBody>
                    <ol className="space-y-2">
                      {timelineEntries.map((e) => (
                        <li key={e.id} className="rounded-lg bg-ink-50 p-3 text-sm">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-brand-600">
                              {Number(e.pctComplete).toFixed(0)}%
                            </span>
                            <span className="text-xs text-ink-400">{fmtDateTime(e.createdAt)}</span>
                          </div>
                          {e.workItem && (
                            <div className="font-medium text-ink-800">{e.workItem}</div>
                          )}
                          {e.notes && <p className="text-xs text-ink-500">{e.notes}</p>}
                          {Array.isArray(e.photos) && (e.photos as string[]).length > 0 && (
                            <div className="mt-2">
                              <PhotoThumbnails
                                photos={(e.photos as string[]).map((src) => ({ src, label: fmtDateTime(e.createdAt) }))}
                              />
                            </div>
                          )}
                          <div className="mt-1 text-[10px] text-ink-400">
                            Reported by {e.submittedBy.name}
                          </div>
                        </li>
                      ))}
                      {p.progressEntries.length === 0 && (
                        <p className="text-sm text-ink-400">Updates will appear here.</p>
                      )}
                    </ol>
                  </CardBody>
                </Card>

                <div className="space-y-4">
                  <Card>
                    <CardHeader title="Payment status" />
                    <CardBody className="space-y-2">
                      {p.paymentTerms.map((t) => {
                        const paid = t.payments.reduce((s, x) => s + Number(x.amount), 0);
                        return (
                          <div
                            key={t.id}
                            className="flex items-center justify-between rounded-lg border border-ink-100 px-3 py-2 text-sm"
                          >
                            <div>
                              <div className="font-medium text-ink-800">{t.label}</div>
                              <div className="text-xs text-ink-400">
                                {php(t.amount.toString())}
                                {paid > 0 && paid < Number(t.amount) && ` · ${php(paid)} received`}
                              </div>
                            </div>
                            <Badge value={t.status} />
                          </div>
                        );
                      })}
                    </CardBody>
                  </Card>

                  {p.rfis.filter((r) => r.status !== "OPEN").length > 0 && (
                    <Card>
                      <CardHeader title="Questions you've answered" />
                      <CardBody className="space-y-2">
                        {p.rfis
                          .filter((r) => r.status !== "OPEN")
                          .map((r) => (
                            <div key={r.id} className="rounded-lg border border-ink-100 px-3 py-2 text-sm">
                              <div className="font-medium text-ink-800">
                                {formatRfiNumber(r.number)} · {r.subject}
                              </div>
                              <div className="text-xs text-ink-500">
                                {r.responseText} — {r.respondedByName}
                                {r.respondedAt && `, ${fmtDate(r.respondedAt)}`}
                              </div>
                            </div>
                          ))}
                      </CardBody>
                    </Card>
                  )}

                  {p.changeOrders.filter((c) => c.status !== "PENDING_CLIENT").length > 0 && (
                    <Card>
                      <CardHeader title="Change order history" />
                      <CardBody className="space-y-2">
                        {p.changeOrders
                          .filter((c) => c.status !== "PENDING_CLIENT")
                          .map((co) => (
                            <div
                              key={co.id}
                              className="flex items-center justify-between rounded-lg border border-ink-100 px-3 py-2 text-sm"
                            >
                              <div>
                                <div className="font-medium text-ink-800">{co.title}</div>
                                <div className="text-xs text-ink-400">
                                  {co.clientResponseAt
                                    ? `Responded ${fmtDate(co.clientResponseAt)}`
                                    : ""}
                                </div>
                              </div>
                              <Badge value={co.status} />
                            </div>
                          ))}
                      </CardBody>
                    </Card>
                  )}
                </div>
              </div>

              <Card>
                <CardHeader title="Request additional work" subtitle="Want something added or changed? Tell us — we'll assess it and get back to you." />
                <CardBody className="space-y-4">
                  <details className="rounded-lg border border-dashed border-ink-200 p-3" open={p.workRequests.length === 0}>
                    <summary className="cursor-pointer text-sm font-medium text-ink-700">+ New request</summary>
                    <div className="mt-3">
                      <NewWorkRequestForm projectId={p.id} />
                    </div>
                  </details>
                  {p.workRequests.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Your requests</p>
                      {p.workRequests.map((w) => (
                        <div key={w.id} className="rounded-lg border border-ink-100 px-3 py-2 text-sm">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="font-medium text-ink-800">
                              {formatWorkRequestNumber(w.number)} · {w.title}
                            </div>
                            <span className="rounded-sm bg-ink-200 px-2 py-0.5 text-xs font-semibold text-ink-700">{clientStatusLabel(w.status)}</span>
                          </div>
                          <p className="mt-1 whitespace-pre-line text-xs text-ink-500">{w.description}</p>
                          <p className="mt-1 text-xs text-ink-400">Sent {fmtDateTime(w.createdAt)}</p>
                          {w.status === "CONVERTED" && w.changeOrder && (
                            <p className="mt-1 text-xs text-ink-600">
                              We've sent you a change order, “{w.changeOrder.title}”
                              {w.changeOrder.status === "PENDING_CLIENT" ? " — please review it in the approval section above." : ` (${w.changeOrder.status.toLowerCase()}).`}
                            </p>
                          )}
                          {w.status === "DECLINED" && w.declineReason && <p className="mt-1 text-xs text-ink-600">Our reply: {w.declineReason}</p>}
                          {isOpenWorkRequest(w.status) && (
                            <div className="mt-1.5">
                              <WithdrawWorkRequestButton id={w.id} />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </CardBody>
              </Card>

              {p.documents.some((d) => d.revisions.length > 0) && (
                <Card>
                  <CardHeader title="Project documents" subtitle="Drawings and documents shared with you — always the latest revision" />
                  <CardBody className="space-y-2">
                    {p.documents
                      .filter((d) => d.revisions.length > 0)
                      .map((d) => (
                        <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ink-100 px-3 py-2 text-sm">
                          <div>
                            <div className="font-medium text-ink-800">
                              {d.docNo && <span className="mr-1.5 text-ink-500">{d.docNo}</span>}
                              {d.title}
                            </div>
                            <div className="text-xs text-ink-400">
                              Revision {d.revisions[0].revision} · {fmtDate(d.revisions[0].createdAt)}
                            </div>
                          </div>
                          <a href={d.revisions[0].url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-brand-600 hover:underline">
                            Open ↗
                          </a>
                        </div>
                      ))}
                  </CardBody>
                </Card>
              )}

              {dailyReports.length > 0 && (
                <Card>
                  <CardHeader
                    title="Daily construction reports"
                    subtitle={`Filed from site, newest first — download a PDF copy before it auto-deletes ${DAILY_REPORT_LIFETIME_DAYS} days after posting`}
                  />
                  <CardBody className="space-y-2">
                    {dailyReports.map((r) => (
                      <DailyReportCard key={r.id} report={r} canEdit={false} canDelete={false} />
                    ))}
                  </CardBody>
                </Card>
              )}
            </section>
          );
        })}
      </main>
    </div>
  );
}
