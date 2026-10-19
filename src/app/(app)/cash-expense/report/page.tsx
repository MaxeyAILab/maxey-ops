import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccess } from "@/lib/access";
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
} from "@/lib/cash-expense";
import { CashExpenseHeader, CashIcons, CashStat, CashStatus, Panel } from "@/components/cash-expense-header";
import { LiquidationForm, RequestActions, VerifyActions } from "@/components/cash-expense-actions";
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
        <a key={src} href={src} target="_blank" rel="noopener noreferrer" className="text-[#8a1a28] hover:underline dark:text-rose-300">
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
export default async function PettyCashReportPage({ searchParams }: { searchParams: { from?: string; to?: string; project?: string } }) {
  const user = await getSessionUser();
  if (!user || !canAccess(user.role, user.department, "/cash-expense", user.customMenus, user.useCustomMenus)) redirect("/attendance");
  const custodian = isCashCustodian(user);
  const canApprove = canApproveCash(user);

  const now = new Date();
  const today = manilaDayKey(now);
  const from = isDay(searchParams.from) ? searchParams.from! : `${today.slice(0, 7)}-01`;
  const to = isDay(searchParams.to) ? searchParams.to! : today;
  const projectFilter = searchParams.project ?? "";

  const mine: Prisma.PettyCashRequestWhereInput = custodian ? {} : { OR: [{ requestedById: user.id }, { createdById: user.id }] };
  const include = { project: { select: { name: true } }, requestedBy: { select: { name: true } } } as const;

  const [open, posted, projects] = await Promise.all([
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
        ],
      },
      orderBy: { liquidatedAt: "asc" },
      include,
    }),
    prisma.project.findMany({ where: { pettyCash: { some: {} } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  const toLiquidate = open.filter((r) => r.status === "RELEASED");
  // Only the person the cash went to reports what it was spent on; everyone else just sees who still owes a report.
  const myToLiquidate = toLiquidate.filter((r) => r.requestedById === user.id);
  const othersToLiquidate = toLiquidate.filter((r) => r.requestedById !== user.id);
  const toVerify = open.filter((r) => r.status === "FOR_LIQUIDATION");
  const totalSpent = posted.reduce((s, r) => s + postedExpense(r), 0);
  const totalReturned = posted.reduce((s, r) => s + liquidationReturn(r), 0);

  // Group the posted expenses by project (General & Administrative last).
  const groups = new Map<string, { name: string; rows: typeof posted }>();
  for (const r of posted) {
    const key = r.projectId ?? NO_PROJECT;
    const g = groups.get(key) ?? { name: r.project?.name ?? NO_PROJECT_LABEL, rows: [] };
    g.rows.push(r);
    groups.set(key, g);
  }
  const grouped = [...groups.entries()].sort(([a, x], [b, y]) => (a === NO_PROJECT ? 1 : b === NO_PROJECT ? -1 : x.name.localeCompare(y.name)));

  return (
    <div className="space-y-6">
      <div className="no-print">
        <CashExpenseHeader
          tab="report"
          title="Petty Cash Report"
          subtitle="Whoever received the cash reports what it was spent on; verified expenses post to their project."
          showAdvances={custodian}
        />
      </div>

      <div className="no-print grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <CashStat icon={CashIcons.people} tone="violet" label="To Liquidate" value={php(toLiquidate.reduce((s, r) => s + Number(r.amount), 0))} sub={`${toLiquidate.length} released request${toLiquidate.length === 1 ? "" : "s"}`} />
        <CashStat icon={CashIcons.clock} tone="amber" label="Awaiting Verification" value={toVerify.length} sub={php(toVerify.reduce((s, r) => s + Number(r.spentAmount ?? 0), 0)) + " spent"} />
        <CashStat icon={CashIcons.receipt} tone="blue" label="Posted Expense" value={php(totalSpent)} sub={`${fmtDate(from)} – ${fmtDate(to)}`} />
        <CashStat icon={CashIcons.cash} tone="green" label="Change Returned" value={php(totalReturned)} sub="Back in the petty cash fund" />
      </div>

      {myToLiquidate.length > 0 && (
        <Panel title="Report your expenses" className="no-print">
          <div className="space-y-4">
            {myToLiquidate.map((r) => (
              <div key={r.id} id={`liquidate-${r.id}`} className="scroll-mt-6 rounded-lg border border-ink-200 p-4">
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
                    <div className="text-lg font-bold tabular-nums text-ink-900">{php(r.amount)}</div>
                    <CashStatus status={r.status} label="Released" />
                  </div>
                </div>
                <LiquidationForm id={r.id} released={Number(r.amount)} custodian={custodian} />
              </div>
            ))}
          </div>
        </Panel>
      )}

      {othersToLiquidate.length > 0 && (
        <Panel title="Waiting for expense reports" className="no-print">
          <div className="space-y-2">
            {othersToLiquidate.map((r) => (
              <div key={r.id} id={`liquidate-${r.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ink-200 px-4 py-3">
                <div>
                  <div className="font-medium text-ink-900">
                    {formatPettyCashNo(r.number)} · {r.purpose}
                  </div>
                  <div className="text-xs text-ink-500">
                    {r.project?.name ?? NO_PROJECT_LABEL} · released {fmtDateTime(r.releasedAt)} · waiting for <b>{r.requestedBy.name}</b> to report what it was spent on
                  </div>
                  {r.liquidationNote?.startsWith("Sent back") && <div className="mt-1 text-xs font-medium text-red-700 dark:text-red-300">{r.liquidationNote}</div>}
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-semibold tabular-nums text-ink-900">{php(r.amount)}</span>
                  <RequestActions id={r.id} status={r.status} canApprove={canApprove} custodian={custodian} own={false} isRequester={false} />
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {toVerify.length > 0 && (
        <Panel title="Awaiting verification" className="no-print">
          <div className="space-y-3">
            {toVerify.map((r) => {
              const items = (r.liquidationItems as Item[] | null) ?? [];
              const change = Math.round((Number(r.amount) - Number(r.spentAmount ?? 0)) * 100) / 100;
              return (
                <div key={r.id} className="rounded-lg border border-ink-200 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-ink-900">
                        {formatPettyCashNo(r.number)} · {r.purpose}
                      </div>
                      <div className="text-xs text-ink-500">
                        {r.project?.name ?? NO_PROJECT_LABEL} · {r.requestedBy.name} · submitted {fmtDateTime(r.liquidationSubmittedAt)}
                      </div>
                    </div>
                    <CashStatus status={r.status} label="For liquidation" />
                  </div>
                  <ul className="mt-3 space-y-1 text-sm">
                    {items.map((i, n) => (
                      <li key={n} className="flex justify-between gap-3 border-b border-dashed border-ink-100 pb-1">
                        <span className="text-ink-700">{i.description}</span>
                        <span className="tabular-nums text-ink-900">{php(i.amount)}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-3 text-sm">
                    <span>
                      Released <b className="tabular-nums">{php(r.amount)}</b> · Spent <b className="tabular-nums">{php(r.spentAmount)}</b> ·{" "}
                      <span className={change < 0 ? "text-red-700 dark:text-red-300" : "text-emerald-700 dark:text-emerald-300"}>
                        {change < 0 ? `reimburse ${php(-change)}` : `change ${php(change)}`}
                      </span>
                    </span>
                    <Receipts urls={r.liquidationReceipts} />
                  </div>
                  {r.liquidationNote && <p className="mt-1 text-xs text-ink-500">Note: {r.liquidationNote}</p>}
                  <div className="mt-3 flex flex-wrap items-start justify-between gap-2">
                    {custodian ? <VerifyActions id={r.id} /> : <p className="text-xs text-ink-500">Waiting for Accounting or the Owner to verify.</p>}
                    <RequestActions id={r.id} status={r.status} canApprove={canApprove} custodian={custodian} own={false} isRequester={false} />
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      <Panel
        title={`Petty Cash Report · ${fmtDate(from)} – ${fmtDate(to)}`}
        action={<PrintButton label="Print / PDF" />}
      >
        <form className="no-print mb-4 flex flex-wrap items-end gap-3 text-sm" method="get">
          <label className="text-ink-600">
            From
            <input type="date" name="from" defaultValue={from} className="ml-2 min-h-[40px] rounded-md border border-ink-200 bg-ink-50 px-2" />
          </label>
          <label className="text-ink-600">
            To
            <input type="date" name="to" defaultValue={to} className="ml-2 min-h-[40px] rounded-md border border-ink-200 bg-ink-50 px-2" />
          </label>
          <label className="text-ink-600">
            Project
            <select name="project" defaultValue={projectFilter} className="ml-2 min-h-[40px] rounded-md border border-ink-200 bg-ink-50 px-2">
              <option value="">All</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
              <option value={NO_PROJECT}>{NO_PROJECT_LABEL}</option>
            </select>
          </label>
          <button type="submit" className="min-h-[40px] rounded-md bg-[#8a1a28] px-4 font-semibold text-white hover:bg-[#741522]">
            Show
          </button>
        </form>

        <div className="overflow-x-auto rounded-lg border border-ink-200">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-ink-100/70 text-ink-700">
              <tr>
                <th className="px-3 py-3 font-semibold">Verified</th>
                <th className="px-3 py-3 font-semibold">PC No.</th>
                <th className="px-3 py-3 font-semibold">Purpose</th>
                <th className="px-3 py-3 font-semibold">Category</th>
                <th className="px-3 py-3 font-semibold">Requested by</th>
                <th className="px-3 py-3 text-right font-semibold">Released</th>
                <th className="px-3 py-3 text-right font-semibold">Spent (posted)</th>
                <th className="px-3 py-3 text-right font-semibold">Change</th>
              </tr>
            </thead>
            {grouped.map(([key, g]) => {
              const spent = g.rows.reduce((s, r) => s + postedExpense(r), 0);
              const released = g.rows.reduce((s, r) => s + Number(r.amount), 0);
              return (
                <tbody key={key}>
                  <tr className="border-t border-ink-200 bg-ink-100/40">
                    <td colSpan={8} className="px-3 py-2 font-semibold text-ink-900">
                      {g.name}
                      {key === NO_PROJECT && <span className="ml-2 text-xs font-normal text-ink-500">company overhead</span>}
                    </td>
                  </tr>
                  {g.rows.map((r) => (
                    <tr key={r.id} className="border-t border-ink-100 align-top">
                      <td className="whitespace-nowrap px-3 py-2 text-ink-700">{fmtDate(r.liquidatedAt)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-ink-700">{formatPettyCashNo(r.number)}</td>
                      <td className="px-3 py-2 text-ink-900">
                        {r.purpose}
                        <div className="no-print">
                          <Receipts urls={r.liquidationReceipts} />
                        </div>
                      </td>
                      <td className="px-3 py-2 text-ink-700">{PETTY_CASH_CATEGORY_LABEL[r.category]}</td>
                      <td className="px-3 py-2 text-ink-700">{r.requestedBy.name}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{php(r.amount)}</td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">{php(r.spentAmount)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{php(liquidationReturn(r))}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-ink-200">
                    <td colSpan={5} className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-ink-500">
                      Subtotal · {g.name}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{php(released)}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{php(spent)}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{php(released - spent)}</td>
                  </tr>
                </tbody>
              );
            })}
            <tbody>
              {posted.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-10 text-center text-ink-500">
                    No liquidated petty cash in this range.
                  </td>
                </tr>
              ) : (
                <tr className="border-t-2 border-ink-300 bg-ink-100/60 font-bold">
                  <td colSpan={5} className="px-3 py-3 text-right">
                    Total posted expense
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">{php(posted.reduce((s, r) => s + Number(r.amount), 0))}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{php(totalSpent)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{php(totalReturned)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-ink-500">
          Each verified amount is part of its project&apos;s committed cost (Projects and Finance); petty cash with no project counts as company overhead.
        </p>
      </Panel>
    </div>
  );
}
