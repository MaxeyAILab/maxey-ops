import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fmtDate, fmtDateTime, php } from "@/lib/format";
import { Badge, Card, CardBody, CardHeader } from "@/components/ui";
import { ChangeOrderRespond } from "@/components/co-respond";
import { SignOutButton } from "@/components/signout-button";

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
      changeOrders: { orderBy: { createdAt: "desc" } },
      progressEntries: {
        where: { visibleToClient: true },
        orderBy: { createdAt: "desc" },
        take: 20,
        include: { submittedBy: { select: { name: true } } },
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
          const latestPct = Number(p.progressEntries[0]?.pctComplete ?? 0);
          const pendingCOs = p.changeOrders.filter((c) => c.status === "PENDING_CLIENT");
          return (
            <section key={p.id} className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h1 className="text-xl font-bold text-ink-900">{p.name}</h1>
                  <p className="text-xs text-ink-500">{p.address}</p>
                </div>
                <Badge value={p.status} />
              </div>

              {/* Progress bar */}
              <Card>
                <CardBody>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-ink-700">Overall progress</span>
                    <span className="font-bold text-brand-600">{latestPct.toFixed(0)}%</span>
                  </div>
                  <div className="mt-2 h-3 overflow-hidden rounded-full bg-ink-100">
                    <div
                      className="h-full rounded-full bg-brand-500"
                      style={{ width: `${Math.min(latestPct, 100)}%` }}
                    />
                  </div>
                </CardBody>
              </Card>

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
                      {p.progressEntries.map((e) => (
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
                            <div className="mt-2 flex flex-wrap gap-2">
                              {(e.photos as string[]).map((src) => (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  key={src}
                                  src={src}
                                  alt="Site photo"
                                  className="h-24 w-24 rounded-lg object-cover"
                                />
                              ))}
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
            </section>
          );
        })}
      </main>
    </div>
  );
}
