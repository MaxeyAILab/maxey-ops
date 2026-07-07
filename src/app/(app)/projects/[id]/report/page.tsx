import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fmtDate, fmtDateTime, php } from "@/lib/format";
import { Badge } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { runGross } from "@/lib/finance";
import { canAccess } from "@/lib/access";

export const dynamic = "force-dynamic";

/**
 * Auto-compiled Project Progress Report (Spec 6.7): photo timeline,
 * instruction log, and cost-to-date — a defensible, attributed record of what
 * was reported, when, and by whom. Print-ready with company letterhead.
 */
export default async function ProjectReportPage({ params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!canAccess(user.role, user.department, "/projects")) redirect("/attendance");

  const p = await prisma.project.findUnique({
    where: { id: params.id },
    include: {
      client: true,
      payments: true,
      paymentTerms: true,
      requisitions: {
        where: { status: { in: ["APPROVED", "PO_ISSUED", "DELIVERED"] } },
        include: { purchaseOrder: true },
      },
      payrollRuns: { where: { status: { in: ["APPROVED", "PAID"] } } },
      progressEntries: {
        orderBy: { createdAt: "desc" },
        include: { submittedBy: { select: { name: true } } },
      },
      instructions: {
        orderBy: { createdAt: "desc" },
        include: { postedBy: { select: { name: true } } },
      },
      deliveries: { orderBy: { createdAt: "desc" }, include: { po: { select: { poNumber: true } } } },
    },
  });
  if (!p) notFound();

  const showMoney = ["OWNER", "PM", "ACCOUNTING"].includes(user.role);
  const received = p.payments.reduce((s, x) => s + Number(x.amount), 0);
  const committed =
    p.payrollRuns.reduce((s, r) => s + runGross(r.entries), 0) +
    p.requisitions.reduce(
      (s, r) => s + (r.purchaseOrder ? Number(r.purchaseOrder.totalCost) : Number(r.estimatedCost ?? 0)),
      0
    );
  const latestPct = Number(p.progressEntries[0]?.pctComplete ?? 0);

  return (
    <div className="space-y-4">
      <div className="no-print flex items-center justify-between gap-3">
        <Link href={`/projects/${p.id}`} className="text-xs text-ink-400 hover:text-ink-600">
          ← Back to project
        </Link>
        <PrintButton label="Print / PDF" />
      </div>

      <div className="mx-auto max-w-3xl rounded-xl border border-ink-200 bg-white p-8 shadow-sm print:border-0 print:shadow-none">
        {/* Letterhead */}
        <div className="flex items-start justify-between border-b-4 border-brand-500 pb-5">
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-brand-500 text-xl font-black text-white">
              M
            </span>
            <div>
              <div className="text-xl font-black tracking-tight text-ink-900">
                MAXEY CONSTRUCTION
              </div>
              <div className="text-xs text-ink-500">
                374 Malapit, San Isidro, Nueva Ecija · PCAB Registered
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-lg font-bold text-brand-600">PROGRESS REPORT</div>
            <div className="text-xs text-ink-400">Generated {fmtDate(new Date())}</div>
          </div>
        </div>

        {/* Summary */}
        <div className="mt-5 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <div>
            <div className="text-xs font-semibold uppercase text-ink-400">Project</div>
            <div className="font-medium text-ink-900">{p.name}</div>
            <div className="text-xs text-ink-500">{p.address}</div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase text-ink-400">Client</div>
            <div className="font-medium text-ink-900">{p.client.name}</div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase text-ink-400">Schedule</div>
            <div className="text-ink-700">
              {fmtDate(p.startDate)} → {fmtDate(p.targetEndDate)}
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase text-ink-400">Overall progress</div>
            <div className="text-lg font-bold text-brand-600">{latestPct.toFixed(0)}%</div>
          </div>
        </div>

        {showMoney && (
          <div className="mt-4 grid grid-cols-3 gap-4 rounded-lg bg-ink-50 p-4 text-sm print:bg-transparent print:p-0">
            <div>
              <div className="text-xs uppercase text-ink-400">Contract value</div>
              <div className="font-semibold tabular-nums">{php(p.contractValue.toString())}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-ink-400">Payments received</div>
              <div className="font-semibold tabular-nums text-emerald-700">{php(received)}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-ink-400">Cost committed to date</div>
              <div className="font-semibold tabular-nums">{php(committed)}</div>
            </div>
          </div>
        )}

        {/* Progress timeline */}
        <h2 className="mt-8 border-b border-ink-200 pb-1 text-sm font-bold uppercase tracking-wide text-ink-700">
          Progress timeline ({p.progressEntries.length} entries)
        </h2>
        <ol className="mt-3 space-y-3">
          {p.progressEntries.map((e) => (
            <li key={e.id} className="flex gap-3 text-sm">
              <div className="w-14 shrink-0 text-right font-bold tabular-nums text-brand-600">
                {Number(e.pctComplete).toFixed(0)}%
              </div>
              <div className="min-w-0 border-l-2 border-ink-100 pl-3">
                <div className="text-xs text-ink-400">
                  {fmtDateTime(e.createdAt)} · reported by {e.submittedBy.name}
                </div>
                {e.workItem && <div className="font-medium text-ink-800">{e.workItem}</div>}
                {e.notes && <p className="text-xs text-ink-600">{e.notes}</p>}
                {Array.isArray(e.photos) && (e.photos as string[]).length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {(e.photos as string[]).map((src) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={src} src={src} alt="" className="h-24 w-24 rounded object-cover" />
                    ))}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>

        {/* Instructions log */}
        <h2 className="mt-8 border-b border-ink-200 pb-1 text-sm font-bold uppercase tracking-wide text-ink-700">
          Site instructions ({p.instructions.length})
        </h2>
        <ul className="mt-3 space-y-2">
          {p.instructions.map((i) => (
            <li key={i.id} className="flex items-start justify-between gap-3 text-sm">
              <div>
                <span className="text-xs text-ink-400">
                  {fmtDateTime(i.createdAt)} · {i.postedBy.name}:
                </span>{" "}
                <span className="text-ink-800">{i.text}</span>
              </div>
              <Badge value={i.status} />
            </li>
          ))}
          {p.instructions.length === 0 && (
            <li className="text-sm text-ink-400">No instructions recorded.</li>
          )}
        </ul>

        {/* Deliveries */}
        <h2 className="mt-8 border-b border-ink-200 pb-1 text-sm font-bold uppercase tracking-wide text-ink-700">
          Material deliveries ({p.deliveries.length})
        </h2>
        <ul className="mt-3 space-y-2">
          {p.deliveries.map((d) => (
            <li key={d.id} className="text-sm">
              <span className="text-xs text-ink-400">{fmtDateTime(d.verifiedAt ?? d.createdAt)}</span>{" "}
              <span className="font-medium text-ink-800">{d.po.poNumber}</span>
              {d.discrepancies ? (
                <span className="text-amber-700"> — ⚠ {d.discrepancies}</span>
              ) : (
                <span className="text-emerald-600"> — complete</span>
              )}
            </li>
          ))}
          {p.deliveries.length === 0 && (
            <li className="text-sm text-ink-400">No deliveries verified yet.</li>
          )}
        </ul>

        <div className="mt-10 text-xs text-ink-400">
          All entries are timestamped and attributed to named users in the Maxey Construction
          operations system (append-only audit log).
        </div>
      </div>
    </div>
  );
}
