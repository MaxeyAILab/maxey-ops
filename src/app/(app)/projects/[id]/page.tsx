import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fmtDate, fmtDateTime, php } from "@/lib/format";
import { Badge, Card, CardBody, CardHeader, Stat, Table, Td, Th } from "@/components/ui";
import { ChangeOrderForm, PaymentForm, ProgressForm } from "@/components/project-actions";
import { PaymentList } from "@/components/payment-list";
import { AccountToggleButton, CreatePortalAccessForm } from "@/components/portal-access";
import { runGross } from "@/lib/finance";
import { canAccess } from "@/lib/access";

export const dynamic = "force-dynamic";

export default async function ProjectDetailPage({ params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role === "CLIENT") redirect("/portal");
  if (!canAccess(user.role, user.department, "/projects")) redirect("/attendance");

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
    },
  });
  if (!p) notFound();

  const showMoney = ["OWNER", "ACCOUNTING", "PM"].includes(user.role);
  const canRecordPayment = ["OWNER", "ACCOUNTING"].includes(user.role);
  const canCreateCO = ["OWNER", "PM"].includes(user.role);
  const canProgress = ["OWNER", "PM", "FOREMAN"].includes(user.role);

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
  const latestPct = Number(p.progressEntries[0]?.pctComplete ?? 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/projects" className="text-xs text-ink-400 hover:text-ink-600">
            ← All projects
          </Link>
          <h1 className="text-xl font-bold text-ink-900">{p.name}</h1>
          <p className="text-xs text-ink-500">
            {p.client.name} · {p.address ?? "no address"} ·{" "}
            {p.startDate ? `started ${fmtDate(p.startDate)}` : "not started"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href={`/projects/${p.id}/report`}
            className="rounded-lg border border-ink-200 px-3 py-1.5 text-sm font-medium text-ink-700 hover:bg-ink-50"
          >
            📄 Progress report
          </Link>
          <Badge value={p.status} />
        </div>
      </div>

      {showMoney && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Stat label="Contract value" value={php(contractValue)} />
          <Stat label="Received" value={php(received)} tone="good" />
          <Stat
            label="Committed cost"
            value={php(committed)}
            sub={`incl. payroll ${php(laborCost)}`}
          />
          <Stat
            label="Est. margin"
            value={php(contractValue - committed)}
            tone={contractValue - committed >= 0 ? "good" : "bad"}
          />
          <Stat label="Progress" value={`${latestPct.toFixed(0)}%`} tone="brand" sub={`retention held ${php(retentionHeld)}`} />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {showMoney && (
          <Card>
            <CardHeader title="Payment terms & billing" subtitle="Downpayment, milestones, retention" />
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
                        {t.dueCondition && (
                          <div className="text-xs text-ink-400">{t.dueCondition}</div>
                        )}
                      </Td>
                      <Td className="text-right tabular-nums">{php(t.amount.toString())}</Td>
                      <Td className="text-right tabular-nums text-emerald-700">{php(paid)}</Td>
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
                  <summary className="cursor-pointer text-sm font-medium text-ink-700">
                    + Record payment received
                  </summary>
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
            {p.changeOrders.map((co) => (
              <div key={co.id} className="rounded-lg border border-ink-100 p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-ink-900">{co.title}</span>
                  <Badge value={co.status} />
                </div>
                <p className="mt-1 text-xs text-ink-500">{co.description}</p>
                <p className="mt-1 text-xs text-ink-600">
                  {showMoney && <>Cost impact {php(co.costImpact.toString())} · </>}
                  {co.timeImpactDays} day(s)
                  {co.clientResponseAt && ` · responded ${fmtDateTime(co.clientResponseAt)}`}
                </p>
              </div>
            ))}
            {p.changeOrders.length === 0 && (
              <p className="text-sm text-ink-400">No change orders.</p>
            )}
            {canCreateCO && (
              <details className="rounded-lg border border-dashed border-ink-200 p-3">
                <summary className="cursor-pointer text-sm font-medium text-ink-700">
                  + New change order
                </summary>
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
              <div
                key={u.id}
                className="flex items-center justify-between rounded-lg border border-ink-100 px-3 py-2 text-sm"
              >
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
                  <Badge
                    value={u.active ? "ACTIVE" : "NOT_ACTIVE"}
                    label={u.active ? "Active" : "Deactivated"}
                  />
                  <AccountToggleButton userId={u.id} name={u.name} active={u.active} />
                </div>
              </div>
            ))}
            {p.client.users.length === 0 && (
              <p className="text-sm text-ink-400">
                No portal login yet — create one so the client can follow progress and approve
                change orders online.
              </p>
            )}
            <details className="rounded-lg border border-dashed border-ink-200 p-3" open={p.client.users.length === 0}>
              <summary className="cursor-pointer text-sm font-medium text-ink-700">
                + Create client login
              </summary>
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
            subtitle="Every entry timestamped and attributed — visible in the client portal"
          />
          <CardBody className="space-y-3">
            {canProgress && <ProgressForm projectId={p.id} />}
            <ol className="space-y-2">
              {p.progressEntries.map((e) => (
                <li key={e.id} className="rounded-lg border border-ink-100 p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-brand-600">
                      {Number(e.pctComplete).toFixed(0)}%
                    </span>
                    <span className="text-xs text-ink-400">
                      {fmtDateTime(e.createdAt)} · {e.submittedBy.name}
                    </span>
                  </div>
                  {e.workItem && <div className="font-medium text-ink-800">{e.workItem}</div>}
                  {e.notes && <p className="text-xs text-ink-500">{e.notes}</p>}
                  {Array.isArray(e.photos) && (e.photos as string[]).length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(e.photos as string[]).map((src) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={src}
                          src={src}
                          alt=""
                          className="h-20 w-20 rounded-lg object-cover"
                        />
                      ))}
                    </div>
                  )}
                </li>
              ))}
              {p.progressEntries.length === 0 && (
                <p className="text-sm text-ink-400">No progress entries yet.</p>
              )}
            </ol>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={`Requisitions (${p.requisitions.length})`} />
          <CardBody className="space-y-2">
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
                    <div className="text-xs text-ink-500">{php(r.estimatedCost.toString())}</div>
                  )}
                </div>
                <Badge value={r.status} />
              </Link>
            ))}
            {p.requisitions.length === 0 && (
              <p className="text-sm text-ink-400">No requisitions for this project.</p>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
