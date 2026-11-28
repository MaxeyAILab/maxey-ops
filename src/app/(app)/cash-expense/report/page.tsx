import Link from "next/link";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canUseCashExpense } from "@/lib/access";
import { fmtDate, fmtDateTime, php } from "@/lib/format";
import { manilaDayKey } from "@/lib/time-rules";
import {
  canApproveCash,
  formatPettyCashNo,
  isCashCustodian,
  liquidationReturn,
  NO_PROJECT,
  NO_PROJECT_LABEL,
  PETTY_CASH_CATEGORY_LABEL,
  postedExpense,
  seesAllPettyCash,
  canAttachReceipts,
  missingReceipt,
  canConfirmChange,
  changeDue,
  CHANGE_TRACKING_FROM,
} from "@/lib/cash-expense";
import { CashExpenseHeader, CashStatus, CashStrip, SectionTitle } from "@/components/cash-expense-header";
import { AutoPrint, QueueTabs, type QueueTab } from "@/components/cash-expense-layout";
import { AddReceipts, ChangeProjectButton, ChangeReturn, EditReportButton, LiquidationForm, NoReceiptFlag, RequestActions, VerifyActions, type EditableReport } from "@/components/cash-expense-actions";
import { PrintButton } from "@/components/print-button";

export const metadata = { title: "Petty Cash Report" };
export const dynamic = "force-dynamic";

const isDay = (s: string | undefined) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

type Item = { description: string; amount: number };

function Receipts({ urls }: { urls: unknown }) {
  const list = Array.isArray(urls) ? (urls as string[]) : [];
  if (list.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-2 text-xs">
      {list.map((src, i) => (
        <a key={src} href={src} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline dark:text-rose-300">
          Receipt {i + 1}
        </a>
      ))}
    </span>
  );
}

/**
 * Petty Cash Report: the person who received released cash reports here what it was really spent on (with receipts), Owner/Accounting
 * verify it, and the verified amount posts as an expense / committed cost of the request's project — or company
 * overhead when it had no project. The report below lists those posted expenses by project for any date range.
 */
export default async function PettyCashReportPage({ searchParams }: { searchParams: { from?: string; to?: string; project?: string; q?: string; print?: string } }) {
  const user = await getSessionUser();
  if (!user || !canUseCashExpense(user)) redirect("/attendance");
  const custodian = isCashCustodian(user);
  const canDelete = canApproveCash(user); // Owner only

  const now = new Date();
  const today = manilaDayKey(now);
  const from = isDay(searchParams.from) ? searchParams.from! : `${today.slice(0, 7)}-01`;
  const to = isDay(searchParams.to) ? searchParams.to! : today;
  const projectFilter = searchParams.project ?? "";
  const q = (searchParams.q ?? "").trim().slice(0, 80);
  const numberMatch = /^(?:pc-?)?0*(\d{1,6})$/i.exec(q);

  // Quick periods: this pay cut-off (1–15 / 16–end of month), this month, last month.
  const ym = today.slice(0, 7);
  const day = Number(today.slice(8, 10));
  const monthEnd = (m: string) => {
    const [y, mo] = m.split("-").map(Number);
    return `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, "0")}`;
  };
  const lastEnd = manilaDayKey(new Date(new Date(`${ym}-01T00:00:00+08:00`).getTime() - 86_400_000));
  const quick = [
    { key: "cutoff", label: "This cut-off", from: day <= 15 ? `${ym}-01` : `${ym}-16`, to: day <= 15 ? `${ym}-15` : monthEnd(ym) },
    { key: "month", label: "This month", from: `${ym}-01`, to: monthEnd(ym) },
    { key: "last", label: "Last month", from: `${lastEnd.slice(0, 7)}-01`, to: lastEnd },
  ];
  // "This month" is also the default view (from the 1st to today).
  const activeQuick = quick.find((p) => p.from === from && (p.to === to || (p.key === "month" && to === today)))?.key ?? "custom";

  const mine: Prisma.PettyCashRequestWhereInput = seesAllPettyCash(user) ? {} : { OR: [{ requestedById: user.id }, { createdById: user.id }] };
  const include = { project: { select: { name: true } }, requestedBy: { select: { name: true } } } as const;

  const [open, posted, projects, turnedIn] = await Promise.all([
    prisma.pettyCashRequest.findMany({
      where: { AND: [mine, { status: { in: ["RELEASED", "FOR_LIQUIDATION"] } }] },
      orderBy: { releasedAt: "asc" },
      include,
    }),
    prisma.pettyCashRequest.findMany({
      where: {
        AND: [
          mine,
          { status: "LIQUIDATED", liquidatedAt: { gte: new Date(`${from}T00:00:00+08:00`), lte: new Date(`${to}T23:59:59.999+08:00`) } },
          projectFilter === NO_PROJECT ? { projectId: null } : projectFilter ? { projectId: projectFilter } : {},
          q
            ? {
                OR: [
                  { purpose: { contains: q, mode: "insensitive" } },
                  { project: { name: { contains: q, mode: "insensitive" } } },
                  { requestedBy: { name: { contains: q, mode: "insensitive" } } },
                  ...(numberMatch ? [{ number: Number(numberMatch[1]) }] : []),
                ],
              }
            : {},
        ],
      },
      orderBy: { liquidatedAt: "asc" },
      include,
    }),
    prisma.project.findMany({ where: { pettyCash: { some: {} } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    // every liquidation that was turned in (waiting or already posted), whatever the date, so none with a missing receipt is hidden by the date filter
    prisma.pettyCashRequest.findMany({
      where: { AND: [mine, { status: { in: ["FOR_LIQUIDATION", "LIQUIDATED"] } }] },
      orderBy: { liquidationSubmittedAt: "desc" },
      include,
      take: 300,
    }),
  ]);
  const missing = turnedIn.filter(missingReceipt);

  // The Owner's "Edit report" dialog needs every project to choose from.
  const editProjects = canDelete ? await prisma.project.findMany({ where: { status: { not: "NOT_ACTIVE" } }, select: { id: true, name: true, isNonCorporate: true }, orderBy: { name: "asc" } }) : [];
  const projectGroups = [
    { group: "Projects", options: editProjects.filter((p) => !p.isNonCorporate).map((p) => ({ value: p.id, label: p.name })) },
    { group: "Non-corporate jobs", options: editProjects.filter((p) => p.isNonCorporate).map((p) => ({ value: p.id, label: p.name })) },
    { group: "No project", options: [{ value: NO_PROJECT, label: `${NO_PROJECT_LABEL} (no project)` }] },
  ].filter((g) => g.options.length > 0);
  const editable = (r: (typeof turnedIn)[number]): EditableReport => ({
    id: r.id,
    no: formatPettyCashNo(r.number),
    purpose: r.purpose,
    category: r.category,
    projectId: r.projectId,
    released: Number(r.amount),
    status: r.status,
    note: r.liquidationNote && !r.liquidationNote.startsWith("Sent back") ? r.liquidationNote : null,
    items: ((r.liquidationItems as { description: string; amount: number }[] | null) ?? []).map((i) => ({ description: i.description, amount: Number(i.amount) })),
    receipts: Array.isArray(r.liquidationReceipts) ? (r.liquidationReceipts as string[]) : [],
  });

  // Change handed back (owner's request 2026-11-17): who released the cash — or someone switched on, or the Owner — confirms it.
  const me = await prisma.user.findUnique({ where: { id: user.id }, select: { receivesChange: true } });
  const changeProps = (r: (typeof turnedIn)[number]) => ({
    id: r.id,
    no: formatPettyCashNo(r.number),
    change: changeDue(r),
    from: r.requestedBy.name,
    releasedBy: r.releasedByName,
    confirmedBy: r.changeReceivedByName,
    confirmedAt: r.changeReceivedAt ? r.changeReceivedAt.toISOString() : null,
    confirmedAmount: r.changeReceivedAmount === null ? null : Number(r.changeReceivedAmount),
    canConfirm: canConfirmChange({ ...user, receivesChange: me?.receivesChange }, r),
    canUndo: canDelete,
    tracked: !!r.liquidationSubmittedAt && r.liquidationSubmittedAt >= CHANGE_TRACKING_FROM,
  });
  const changeOwed = turnedIn.filter((r) => changeDue(r) > 0 && !r.changeReceivedAt && !!r.liquidationSubmittedAt && r.liquidationSubmittedAt >= CHANGE_TRACKING_FROM);

  const toLiquidate = open.filter((r) => r.status === "RELEASED");
  // Only the person the cash went to reports what it was spent on; everyone else just sees who still owes a report.
  const myToLiquidate = toLiquidate.filter((r) => r.requestedById === user.id);
  const othersToLiquidate = toLiquidate.filter((r) => r.requestedById !== user.id);
  const toVerify = open.filter((r) => r.status === "FOR_LIQUIDATION");
  const totalSpent = posted.reduce((s, r) => s + postedExpense(r), 0);
  const totalReturned = posted.reduce((s, r) => s + liquidationReturn(r), 0);
  const totalReleased = posted.reduce((s, r) => s + Number(r.amount), 0);

  // Group the posted expenses by project (General & Administrative last).
  const groups = new Map<string, { name: string; rows: typeof posted }>();
  for (const r of posted) {
    const key = r.projectId ?? NO_PROJECT;
    const g = groups.get(key) ?? { name: r.project?.name ?? NO_PROJECT_LABEL, rows: [] };
    g.rows.push(r);
    groups.set(key, g);
  }
  const grouped = [...groups.entries()].sort(([a, x], [b, y]) => (a === NO_PROJECT ? 1 : b === NO_PROJECT ? -1 : x.name.localeCompare(y.name)));

  const reportHref = (next: Record<string, string>) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries({ from, to, project: projectFilter, q, ...next })) if (v) sp.set(k, v);
    return `/cash-expense/report?${sp.toString()}`;
  };
  const projectName = projectFilter === NO_PROJECT ? NO_PROJECT_LABEL : projects.find((p) => p.id === projectFilter)?.name;

  // ---- work queue lists (content unchanged, one list at a time) ----
  const missingList = (
    <div id="missing-receipts" className="scroll-mt-6 space-y-2 p-3 sm:p-4">
      <p className="text-xs text-amber-900 dark:text-amber-200">
        {custodian
          ? "These expense reports were turned in without a receipt. Ask the requester for it, or attach it here yourself."
          : "These expense reports of yours have no receipt yet. Attach the receipt photo so Accounting can verify them."}
      </p>
      {missing.map((r) => (
        <div key={r.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50/60 px-4 py-3 dark:border-amber-800 dark:bg-amber-950/20">
          <div className="min-w-0">
            <div className="font-medium text-ink-900">
              {formatPettyCashNo(r.number)} · {r.purpose}
            </div>
            <div className="text-xs text-ink-600">
              {r.project?.name ?? NO_PROJECT_LABEL} · {r.requestedBy.name} · spent {php(r.spentAmount)} · turned in {fmtDateTime(r.liquidationSubmittedAt)} ·{" "}
              {r.status === "LIQUIDATED" ? "already verified and posted" : "waiting for verification"}
            </div>
          </div>
          {canAttachReceipts(user, r) ? <AddReceipts id={r.id} hasNone /> : <span className="text-xs text-ink-500">Only {r.requestedBy.name} or Accounting can attach it</span>}
        </div>
      ))}
    </div>
  );

  const myList = (
    <div className="space-y-4 p-3 sm:p-4">
      {myToLiquidate.map((r) => (
        <div key={r.id} id={`liquidate-${r.id}`} className="scroll-mt-6 rounded-xl border border-ink-200 p-4">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="font-semibold text-ink-900">
                {formatPettyCashNo(r.number)} · {r.purpose}
              </div>
              <div className="text-xs text-ink-500">
                {r.project?.name ?? NO_PROJECT_LABEL} · {PETTY_CASH_CATEGORY_LABEL[r.category]} · {r.requestedBy.name} · released {fmtDateTime(r.releasedAt)}
                {r.releasedByName && ` by ${r.releasedByName}`}
              </div>
              {r.liquidationNote?.startsWith("Sent back") && <div className="mt-1 text-xs font-medium text-red-700 dark:text-red-300">{r.liquidationNote}</div>}
            </div>
            <div className="text-right">
              <div className="font-mono text-lg font-bold text-ink-900">{php(r.amount)}</div>
              <CashStatus status={r.status} label="Released" />
              {canDelete && (
                <div className="mt-1.5">
                  <ChangeProjectButton id={r.id} no={formatPettyCashNo(r.number)} projectId={r.projectId} projectGroups={projectGroups} />
                </div>
              )}
            </div>
          </div>
          {r.receivedAt ? (
            <LiquidationForm id={r.id} released={Number(r.amount)} custodian={custodian} />
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
              <span>First confirm that you received this cash — then you can report what it was spent on.</span>
              <RequestActions id={r.id} status={r.status} canApprove={false} canRelease={false} canDelete={false} custodian={false} own isRequester received={false} />
            </div>
          )}
        </div>
      ))}
    </div>
  );

  const waitingList = (
    <div className="divide-y divide-ink-100">
      {othersToLiquidate.map((r) => (
        <div key={r.id} id={`liquidate-${r.id}`} className="flex scroll-mt-6 flex-wrap items-center justify-between gap-3 px-3 py-3 sm:px-4">
          <div className="min-w-0">
            <div className="font-medium text-ink-900">
              {formatPettyCashNo(r.number)} · {r.purpose}
            </div>
            <div className="text-xs text-ink-500">
              {r.project?.name ?? NO_PROJECT_LABEL} · released {fmtDateTime(r.releasedAt)} · waiting for <b>{r.requestedBy.name}</b> to {r.receivedAt ? "report what it was spent on" : "confirm receiving the cash"}
            </div>
            {r.liquidationNote?.startsWith("Sent back") && <div className="mt-1 text-xs font-medium text-red-700 dark:text-red-300">{r.liquidationNote}</div>}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono font-semibold text-ink-900">{php(r.amount)}</span>
            {canDelete && <ChangeProjectButton id={r.id} no={formatPettyCashNo(r.number)} projectId={r.projectId} projectGroups={projectGroups} />}
            <RequestActions id={r.id} status={r.status} canApprove={false} canRelease={false} canDelete={canDelete} custodian={custodian} own={false} isRequester={false} received={!!r.receivedAt} />
          </div>
        </div>
      ))}
    </div>
  );

  const verifyList = (
    <div className="divide-y divide-ink-100">
      {toVerify.map((r) => {
        const items = (r.liquidationItems as Item[] | null) ?? [];
        const change = Math.round((Number(r.amount) - Number(r.spentAmount ?? 0)) * 100) / 100;
        return (
          <details key={r.id} id={`verify-${r.id}`} open={toVerify.length === 1} className="group/v">
            <summary className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-3 py-3 hover:bg-ink-100/40 sm:grid-cols-[minmax(0,1fr)_160px_110px_auto] sm:px-4 [&::-webkit-details-marker]:hidden">
              <span className="min-w-0">
                <span className="block truncate font-semibold text-ink-900">
                  {formatPettyCashNo(r.number)} · {r.purpose}
                </span>
                <span className="block truncate text-xs text-ink-500">
                  {r.project?.name ?? NO_PROJECT_LABEL} · released {php(r.amount)} · {change < 0 ? `reimburse ${php(-change)}` : `change ${php(change)}`}
                  {missingReceipt(r) && <b className="ml-1 text-accent">· no receipt</b>}
                </span>
              </span>
              <span className="hidden truncate text-xs text-ink-600 sm:block">{r.requestedBy.name}</span>
              <span className="text-right font-mono font-bold text-ink-900">{php(r.spentAmount)}</span>
              <span className="col-span-2 sm:col-span-1">
                <span className="fx-grad inline-flex rounded-full bg-accent px-3.5 py-1.5 text-xs font-semibold text-white group-open/v:hidden">Review →</span>
                <span className="hidden rounded-full border border-ink-200 px-3.5 py-1.5 text-xs font-semibold text-ink-600 group-open/v:inline-flex">Close ▴</span>
              </span>
            </summary>
            <div className="mx-3 mb-3 rounded-xl border border-ink-200 bg-ink-100/40 p-4 sm:mx-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="text-xs text-ink-500">
                  {r.requestedBy.name} · submitted {fmtDateTime(r.liquidationSubmittedAt)}
                </div>
                <div className="flex flex-col items-end gap-1">
                  <CashStatus status={r.status} label="For liquidation" />
                  {missingReceipt(r) && <NoReceiptFlag />}
                </div>
              </div>
              <ul className="mt-3 space-y-1 text-sm">
                {items.map((i, n) => (
                  <li key={n} className="flex justify-between gap-3 border-b border-dashed border-ink-200 pb-1">
                    <span className="text-ink-700">{i.description}</span>
                    <span className="font-mono text-ink-900">{php(i.amount)}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-3 text-sm">
                <span>
                  Released <b className="font-mono">{php(r.amount)}</b> · Spent <b className="font-mono">{php(r.spentAmount)}</b> ·{" "}
                  <span className={change < 0 ? "text-red-700 dark:text-red-300" : "text-emerald-700 dark:text-emerald-300"}>{change < 0 ? `reimburse ${php(-change)}` : `change ${php(change)}`}</span>
                </span>
                <Receipts urls={r.liquidationReceipts} />
              </div>
              {r.liquidationNote && <p className="mt-1 text-xs text-ink-500">Note: {r.liquidationNote}</p>}
              <div className="mt-2">
                <ChangeReturn {...changeProps(r)} />
              </div>
              {canAttachReceipts(user, r) && (
                <div className="mt-2">
                  <AddReceipts id={r.id} hasNone={missingReceipt(r)} />
                </div>
              )}
              {canDelete && (
                <div className="mt-2">
                  <EditReportButton report={editable(r)} projectGroups={projectGroups} />
                </div>
              )}
              <div className="mt-3 flex flex-wrap items-start justify-between gap-2">
                {custodian ? <VerifyActions id={r.id} noReceipt={missingReceipt(r)} /> : <p className="text-xs text-ink-500">Waiting for Accounting or the Owner to verify.</p>}
                <RequestActions id={r.id} status={r.status} canApprove={false} canRelease={false} canDelete={canDelete} custodian={custodian} own={false} isRequester={false} received={!!r.receivedAt} />
              </div>
            </div>
          </details>
        );
      })}
    </div>
  );

  const changeList = (
    <div className="p-3 sm:p-4">
      <p className="mb-3 text-xs text-ink-500">
        Expenses were reported and money is left over. Once the change is handed back, the person who released the cash — or anyone switched on for &quot;Receives returned change&quot; on the People page, or the Owner — presses <b>Change received</b>.
      </p>
      <div className="divide-y divide-ink-100 rounded-xl border border-ink-200">
        {changeOwed.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-sm">
            <div>
              <span className="font-semibold text-ink-900">{formatPettyCashNo(r.number)}</span>
              <span className="text-ink-600">
                {" "}
                · {r.requestedBy.name} · {r.project?.name ?? NO_PROJECT_LABEL}
              </span>
              <div className="text-xs text-ink-500">
                Released {php(r.amount)}
                {r.releasedByName ? ` by ${r.releasedByName}` : ""} · spent {php(r.spentAmount)} · {r.status === "LIQUIDATED" ? "report verified" : "report waiting for verification"}
              </div>
            </div>
            <ChangeReturn {...changeProps(r)} compact />
          </div>
        ))}
      </div>
    </div>
  );

  const queue: QueueTab[] = [
    ...(myToLiquidate.length ? [{ key: "mine", label: "Report your expenses", count: myToLiquidate.length, content: myList }] : []),
    { key: "verify", label: "To verify", count: toVerify.length, content: verifyList },
    { key: "missing", label: "Missing receipts", count: missing.length, content: missingList },
    { key: "waiting", label: "Waiting for reports", count: othersToLiquidate.length, content: waitingList },
    { key: "change", label: "Change to hand back", count: changeOwed.length, content: changeList },
  ];
  const queueTotal = queue.reduce((s, t) => s + t.count, 0);
  const firstQueue = queue.find((t) => t.count > 0)?.key ?? "verify";

  const lineCols = "grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 sm:grid-cols-[64px_70px_minmax(0,1fr)_150px_110px_110px_110px]";

  return (
    <div className="space-y-5">
      <AutoPrint when={searchParams.print === "1"} />
      <div className="no-print">
        <CashExpenseHeader
          tab="report"
          title="Petty Cash Report"
          subtitle="Whoever received the cash reports what it was spent on; verified expenses post to their project."
          showAdvances
          showFund={seesAllPettyCash(user)}
          action={<PrintButton label="Print / PDF" />}
        />
      </div>

      {/* 1 — money strip */}
      <div className="no-print">
        <CashStrip
          items={[
            { label: "To liquidate", value: php(toLiquidate.reduce((s, r) => s + Number(r.amount), 0)), tone: toLiquidate.length ? "bad" : undefined, sub: `${toLiquidate.length} released request${toLiquidate.length === 1 ? "" : "s"}` },
            { label: "Awaiting verification", value: toVerify.length, sub: `${php(toVerify.reduce((s, r) => s + Number(r.spentAmount ?? 0), 0))} spent` },
            { label: "Posted expense", value: php(totalSpent), sub: `${fmtDate(from)} – ${fmtDate(to)}` },
            { label: "Change returned", value: php(totalReturned), tone: "good", sub: "Back in the petty cash fund" },
          ]}
        />
      </div>

      {/* 2 — work queue */}
      <div className="no-print">
        {queueTotal > 0 ? (
          <section className="fx-card min-w-0 overflow-hidden rounded-2xl border border-ink-200 bg-ink-50">
            <QueueTabs tabs={queue} initial={firstQueue} />
          </section>
        ) : (
          <p className="fx-card rounded-2xl border border-ink-200 bg-ink-50 px-4 py-3 text-sm text-ink-600">
            <span className="fx-ok font-semibold">All clear ✓</span> — no reports to verify, no missing receipts, nobody owes an expense report or change.
          </p>
        )}
      </div>

      {/* 3 — report by project */}
      <div className="no-print">
        <SectionTitle>Report by project</SectionTitle>
        <section className="fx-card min-w-0 overflow-hidden rounded-2xl border border-ink-200 bg-ink-50">
          <div className="flex flex-wrap items-center gap-1.5 border-b border-ink-100 px-3 py-3 sm:px-4">
            {quick.map((p) => (
              <Link key={p.key} href={reportHref({ from: p.from, to: p.to })} className={`fx-pill ${activeQuick === p.key ? "fx-pill-on" : ""}`}>
                {p.label}
              </Link>
            ))}
            <details className="relative">
              <summary className={`fx-pill cursor-pointer list-none [&::-webkit-details-marker]:hidden ${activeQuick === "custom" ? "fx-pill-on" : ""}`}>
                {activeQuick === "custom" ? `${fmtDate(from)} – ${fmtDate(to)}` : "Custom…"}
              </summary>
              <form method="get" action="/cash-expense/report" className="absolute left-0 z-20 mt-2 flex w-64 flex-col gap-2 rounded-xl border border-ink-200 bg-ink-50 p-3 shadow-lg">
                {q && <input type="hidden" name="q" value={q} />}
                {projectFilter && <input type="hidden" name="project" value={projectFilter} />}
                <label className="text-xs text-ink-600">
                  From
                  <input type="date" name="from" defaultValue={from} className="mt-1 block min-h-[40px] w-full rounded-lg border border-ink-200 bg-ink-50 px-2 text-ink-900" />
                </label>
                <label className="text-xs text-ink-600">
                  To
                  <input type="date" name="to" defaultValue={to} className="mt-1 block min-h-[40px] w-full rounded-lg border border-ink-200 bg-ink-50 px-2 text-ink-900" />
                </label>
                <button type="submit" className="fx-grad min-h-[40px] rounded-lg bg-accent text-sm font-semibold text-white">
                  Show
                </button>
              </form>
            </details>
            <form method="get" action="/cash-expense/report" className="flex min-w-[220px] flex-1 items-center gap-2">
              <input type="hidden" name="from" value={from} />
              <input type="hidden" name="to" value={to} />
              {projectFilter && <input type="hidden" name="project" value={projectFilter} />}
              <label className="flex min-h-[42px] min-w-0 flex-1 items-center gap-2 rounded-full border border-ink-200 bg-ink-50 px-4">
                <span aria-hidden className="text-ink-400">
                  ⌕
                </span>
                <input name="q" defaultValue={q} placeholder="Find a project, PC no., purpose or person…" className="min-w-0 flex-1 bg-transparent text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none" />
              </label>
            </form>
          </div>
          {(q || projectFilter) && (
            <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 px-3 py-2 text-xs text-ink-600 sm:px-4">
              Showing {projectName && <b>{projectName}</b>}
              {projectName && q && " · "}
              {q && (
                <>
                  matches for <b>“{q}”</b>
                </>
              )}
              <Link href={reportHref({ q: "", project: "" })} className="font-semibold text-brand-600 hover:underline">
                Show all projects
              </Link>
            </div>
          )}

          <div className="hidden grid-cols-[minmax(0,1fr)_140px_130px_130px_110px_52px] gap-3 border-b border-ink-100 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-400 sm:grid">
            <span>Project</span>
            <span>Share of spend</span>
            <span className="text-right">Released</span>
            <span className="text-right">Spent</span>
            <span className="text-right">Change</span>
            <span />
          </div>

          {grouped.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-ink-500">No liquidated petty cash in this range.</p>
          ) : (
            grouped.map(([key, g]) => {
              const spent = g.rows.reduce((s, r) => s + postedExpense(r), 0);
              const released = g.rows.reduce((s, r) => s + Number(r.amount), 0);
              const share = totalSpent > 0 ? Math.round((spent / totalSpent) * 100) : 0;
              const noReceipt = g.rows.filter(missingReceipt).length;
              return (
                <details key={key} open={grouped.length === 1 || !!q} className="group/p border-b border-ink-100">
                  <summary className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-3 hover:bg-ink-100/40 sm:grid-cols-[minmax(0,1fr)_140px_130px_130px_110px_52px] sm:px-4 [&::-webkit-details-marker]:hidden">
                    <span className="flex min-w-0 items-center gap-2.5">
                      <span aria-hidden className="text-[10px] text-ink-500 transition group-open/p:rotate-90">
                        ▶
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-bold text-ink-900">{g.name}</span>
                        <span className="block text-[11px] text-ink-500">
                          {g.rows.length} expense{g.rows.length === 1 ? "" : "s"}
                          {key === NO_PROJECT && " · company overhead"}
                          {noReceipt > 0 && <span className="text-accent"> · {noReceipt} no receipt</span>}
                        </span>
                      </span>
                    </span>
                    <span className="hidden items-center gap-2 sm:flex">
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-200">
                        <span className="fx-grad block h-full bg-accent" style={{ width: `${share}%` }} />
                      </span>
                      <span className="w-8 text-right font-mono text-[11px] text-ink-500">{share}%</span>
                    </span>
                    <span className="hidden text-right font-mono text-ink-700 sm:block">{php(released)}</span>
                    <span className="text-right font-mono font-bold text-ink-900">{php(spent)}</span>
                    <span className="hidden text-right font-mono text-ink-700 sm:block">{php(released - spent)}</span>
                    <Link href={reportHref({ project: key, q: "", print: "1" })} className="hidden text-right text-xs font-semibold text-brand-600 hover:underline sm:block">
                      Print
                    </Link>
                  </summary>
                  <div className="bg-ink-100/30 px-3 pb-2 sm:px-4">
                    {g.rows.map((r) => (
                      <div key={r.id} className={`${lineCols} items-start border-t border-dashed border-ink-200 py-2.5 text-sm first:border-t-0`}>
                        <span className="hidden font-mono text-xs text-ink-500 sm:block">{fmtDate(r.liquidatedAt)}</span>
                        <span className="hidden font-mono text-xs text-ink-500 sm:block">{formatPettyCashNo(r.number)}</span>
                        <span className="min-w-0">
                          <span className="block text-ink-900">
                            {r.purpose} <span className="text-xs text-ink-500">· {PETTY_CASH_CATEGORY_LABEL[r.category]}</span>
                          </span>
                          <span className="block text-xs text-ink-500 sm:hidden">
                            {fmtDate(r.liquidatedAt)} · {formatPettyCashNo(r.number)} · {r.requestedBy.name}
                          </span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-2">
                            <Receipts urls={r.liquidationReceipts} />
                            {canDelete && <EditReportButton report={editable(r)} projectGroups={projectGroups} />}
                            {missingReceipt(r) && (
                              <>
                                <NoReceiptFlag />
                                {canAttachReceipts(user, r) && <AddReceipts id={r.id} hasNone />}
                              </>
                            )}
                          </span>
                        </span>
                        <span className="hidden text-xs text-ink-600 sm:block">{r.requestedBy.name}</span>
                        <span className="hidden text-right font-mono text-xs text-ink-600 sm:block">{php(r.amount)}</span>
                        <span className="text-right font-mono font-semibold text-ink-900">{php(r.spentAmount)}</span>
                        <span className="col-span-2 text-right font-mono text-xs text-ink-600 sm:col-span-1">
                          <span className="sm:hidden">change </span>
                          {php(liquidationReturn(r))}
                          <span className="mt-1 block">
                            <ChangeReturn {...changeProps(r)} compact />
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                </details>
              );
            })
          )}
          {posted.length > 0 && (
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 bg-ink-100/60 px-3 py-3 font-bold sm:grid-cols-[minmax(0,1fr)_140px_130px_130px_110px_52px] sm:px-4">
              <span className="text-ink-900">Total posted</span>
              <span className="hidden sm:block" />
              <span className="hidden text-right font-mono sm:block">{php(totalReleased)}</span>
              <span className="text-right font-mono">{php(totalSpent)}</span>
              <span className="hidden text-right font-mono sm:block">{php(totalReturned)}</span>
              <span className="hidden sm:block" />
            </div>
          )}
        </section>
        <p className="mt-2 text-xs text-ink-500">
          Each verified amount is part of its project&apos;s committed cost (Projects and Finance); petty cash with no project counts as company overhead.
        </p>
      </div>

      {/* Printed report: the full table, every project opened up */}
      <div className="print-only">
        <h2 className="mb-3 text-lg font-bold">
          Petty Cash Report · {fmtDate(from)} – {fmtDate(to)}
          {projectName ? ` · ${projectName}` : ""}
        </h2>
        <table className="w-full text-left text-[11px]">
          <thead>
            <tr className="border-b border-black">
              <th className="px-2 py-1.5">Verified</th>
              <th className="px-2 py-1.5">PC No.</th>
              <th className="px-2 py-1.5">Purpose</th>
              <th className="px-2 py-1.5">Category</th>
              <th className="px-2 py-1.5">Requested by</th>
              <th className="px-2 py-1.5 text-right">Released</th>
              <th className="px-2 py-1.5 text-right">Spent (posted)</th>
              <th className="px-2 py-1.5 text-right">Change</th>
            </tr>
          </thead>
          {grouped.map(([key, g]) => {
            const spent = g.rows.reduce((s, r) => s + postedExpense(r), 0);
            const released = g.rows.reduce((s, r) => s + Number(r.amount), 0);
            return (
              <tbody key={key}>
                <tr className="border-t border-gray-400">
                  <td colSpan={8} className="px-2 py-1.5 font-bold">
                    {g.name}
                    {key === NO_PROJECT && " (company overhead)"}
                  </td>
                </tr>
                {g.rows.map((r) => (
                  <tr key={r.id} className="border-t border-gray-200 align-top">
                    <td className="whitespace-nowrap px-2 py-1">{fmtDate(r.liquidatedAt)}</td>
                    <td className="whitespace-nowrap px-2 py-1">{formatPettyCashNo(r.number)}</td>
                    <td className="px-2 py-1">
                      {r.purpose}
                      {missingReceipt(r) && " (no receipt)"}
                    </td>
                    <td className="px-2 py-1">{PETTY_CASH_CATEGORY_LABEL[r.category]}</td>
                    <td className="px-2 py-1">{r.requestedBy.name}</td>
                    <td className="px-2 py-1 text-right">{php(r.amount)}</td>
                    <td className="px-2 py-1 text-right">{php(r.spentAmount)}</td>
                    <td className="px-2 py-1 text-right">{php(liquidationReturn(r))}</td>
                  </tr>
                ))}
                <tr className="border-t border-gray-400">
                  <td colSpan={5} className="px-2 py-1 text-right font-semibold">
                    Subtotal · {g.name}
                  </td>
                  <td className="px-2 py-1 text-right font-semibold">{php(released)}</td>
                  <td className="px-2 py-1 text-right font-semibold">{php(spent)}</td>
                  <td className="px-2 py-1 text-right font-semibold">{php(released - spent)}</td>
                </tr>
              </tbody>
            );
          })}
          <tbody>
            {posted.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-2 py-6 text-center">
                  No liquidated petty cash in this range.
                </td>
              </tr>
            ) : (
              <tr className="border-t-2 border-black font-bold">
                <td colSpan={5} className="px-2 py-1.5 text-right">
                  Total posted expense
                </td>
                <td className="px-2 py-1.5 text-right">{php(totalReleased)}</td>
                <td className="px-2 py-1.5 text-right">{php(totalSpent)}</td>
                <td className="px-2 py-1.5 text-right">{php(totalReturned)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
