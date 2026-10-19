import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccess } from "@/lib/access";
import { php } from "@/lib/format";
import { manilaDayKey } from "@/lib/time-rules";
import {
  canApproveCash,
  formatPettyCashNo,
  fundBalance,
  isCashCustodian,
  NO_PROJECT,
  NO_PROJECT_LABEL,
  PETTY_CASH_CATEGORY_LABEL,
  PETTY_CASH_STATUS_LABEL,
  unliquidated,
} from "@/lib/cash-expense";
import { CashExpenseHeader, CashIcons, CashStat, CashStatus, Panel } from "@/components/cash-expense-header";
import { ActivityFilters, FundForm, QuickRecordForm, RequestActions } from "@/components/cash-expense-actions";

export const metadata = { title: "Petty Cash" };
export const dynamic = "force-dynamic";

const TIME_FMT = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Start of the Manila calendar month containing `d`. */
function manilaMonthStart(d: Date) {
  return new Date(`${manilaDayKey(d).slice(0, 7)}-01T00:00:00+08:00`);
}

const isDay = (s: string | undefined) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export default async function PettyCashPage({ searchParams }: { searchParams: { status?: string; from?: string; to?: string; q?: string } }) {
  const user = await getSessionUser();
  if (!user || !canAccess(user.role, user.department, "/cash-expense", user.customMenus, user.useCustomMenus)) redirect("/attendance");
  const custodian = isCashCustodian(user);
  const canApprove = canApproveCash(user);

  // Default view: the last 7 days, like the Owner's mock-up.
  const now = new Date();
  const today = manilaDayKey(now);
  const to = isDay(searchParams.to) ? searchParams.to! : today;
  const from = isDay(searchParams.from) ? searchParams.from! : manilaDayKey(new Date(now.getTime() - 6 * 86_400_000));
  const status = searchParams.status && PETTY_CASH_STATUS_LABEL[searchParams.status] ? searchParams.status : "";
  const q = (searchParams.q ?? "").trim().slice(0, 80);

  // Everyone but the custodians only ever sees requests they filed or that are theirs.
  const mine: Prisma.PettyCashRequestWhereInput = custodian ? {} : { OR: [{ requestedById: user.id }, { createdById: user.id }] };
  const numberMatch = /^(?:pc-?)?0*(\d{1,6})$/i.exec(q);
  const where: Prisma.PettyCashRequestWhereInput = {
    AND: [
      mine,
      { createdAt: { gte: new Date(`${from}T00:00:00+08:00`), lte: new Date(`${to}T23:59:59.999+08:00`) } },
      status ? { status: status as never } : {},
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
  };

  const monthStart = manilaMonthStart(now);
  const [rows, all, fund, projects, people] = await Promise.all([
    prisma.pettyCashRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { project: { select: { name: true } }, requestedBy: { select: { name: true } } },
    }),
    prisma.pettyCashRequest.findMany({
      where: custodian ? {} : mine,
      select: { status: true, amount: true, spentAmount: true, releasedAt: true },
    }),
    custodian ? prisma.pettyCashFundEntry.findMany({ select: { amount: true } }) : Promise.resolve([]),
    prisma.project.findMany({
      where: { status: { not: "NOT_ACTIVE" } },
      select: { id: true, name: true, isNonCorporate: true },
      orderBy: { name: "asc" },
    }),
    custodian
      ? prisma.user.findMany({ where: { active: true, role: { not: "CLIENT" } }, select: { id: true, name: true }, orderBy: { name: "asc" } })
      : Promise.resolve([]),
  ]);

  const balance = custodian ? fundBalance(fund, all) : 0;
  const pending = all.filter((r) => r.status === "PENDING").length;
  const releasedThisMonth = all.filter((r) => r.releasedAt && r.releasedAt >= monthStart).reduce((s, r) => s + Number(r.amount), 0);
  const outstanding = all.reduce((s, r) => s + unliquidated(r), 0);

  const projectGroups = [
    { group: "Projects", options: projects.filter((p) => !p.isNonCorporate).map((p) => ({ value: p.id, label: p.name })) },
    { group: "Non-corporate jobs", options: projects.filter((p) => p.isNonCorporate).map((p) => ({ value: p.id, label: p.name })) },
    { group: "No project", options: [{ value: NO_PROJECT, label: `${NO_PROJECT_LABEL} (no project)` }] },
  ].filter((g) => g.options.length > 0);

  return (
    <div className="space-y-6">
      <CashExpenseHeader
        tab="petty-cash"
        title="Petty Cash"
        subtitle="Submit requests, record disbursements, and track the running balance in real time."
        showAdvances={custodian}
        action={
          <a href="#quick-record" className="inline-flex min-h-[44px] items-center gap-2 rounded-md bg-[#8a1a28] px-4 text-sm font-semibold text-white hover:bg-[#741522]">
            <span aria-hidden className="text-lg leading-none">+</span> New Petty Cash Request
          </a>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {custodian ? (
          <CashStat icon={CashIcons.cash} tone="green" label="Available Petty Cash" value={php(balance)} sub={<FundForm />} />
        ) : (
          <CashStat icon={CashIcons.cash} tone="green" label="My requests (all time)" value={all.length} />
        )}
        <CashStat icon={CashIcons.clock} tone="amber" label={custodian ? "Pending Requests" : "My Pending Requests"} value={pending} />
        <CashStat icon={CashIcons.trend} tone="blue" label="Released This Month" value={php(releasedThisMonth)} />
        <CashStat icon={CashIcons.people} tone="violet" label="Unliquidated Advances" value={php(outstanding)} sub="Released, receipts not yet verified" />
      </div>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.6fr)]">
        <Panel title="Quick Record">
          <QuickRecordForm
            projects={projectGroups}
            people={people.map((p) => ({ value: p.id, label: p.name }))}
            me={{ value: user.id, label: user.name }}
            canPickRequester={custodian}
          />
        </Panel>

        <Panel
          title="Recent Petty Cash Activity"
          action={
            custodian ? (
              <span className="inline-flex items-center gap-2 text-sm text-ink-600">
                <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                  ▤
                </span>
                Running Balance <b className="tabular-nums text-ink-900">{php(balance)}</b>
              </span>
            ) : undefined
          }
        >
          <ActivityFilters status={status} from={from} to={to} q={q} />
          <div className="mt-4 overflow-x-auto rounded-lg border border-ink-200">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-ink-100/70 text-ink-700">
                <tr>
                  <th className="px-4 py-3 font-semibold">Date &amp; Time</th>
                  <th className="px-4 py-3 font-semibold">Request / Purpose</th>
                  <th className="px-4 py-3 font-semibold">Project</th>
                  <th className="px-4 py-3 text-right font-semibold">Amount</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const own = r.requestedById === user.id || r.createdById === user.id;
                  return (
                    <tr key={r.id} className="border-t border-ink-100 align-top">
                      <td className="whitespace-nowrap px-4 py-4 text-ink-700">{TIME_FMT.format(r.createdAt)}</td>
                      <td className="px-4 py-4">
                        <div className="text-ink-900">{r.purpose}</div>
                        <div className="mt-0.5 text-xs text-ink-500">
                          {formatPettyCashNo(r.number)} · {PETTY_CASH_CATEGORY_LABEL[r.category]} · {r.requestedBy.name}
                        </div>
                        {r.status === "REJECTED" && r.rejectedReason && <div className="mt-1 text-xs text-red-700 dark:text-red-300">Rejected: {r.rejectedReason}</div>}
                        {Array.isArray(r.receipts) && (r.receipts as string[]).length > 0 && (
                          <div className="mt-1 flex gap-2 text-xs">
                            {(r.receipts as string[]).map((src, i) => (
                              <a key={src} href={src} target="_blank" rel="noopener noreferrer" className="text-[#8a1a28] hover:underline dark:text-rose-300">
                                Receipt {i + 1}
                              </a>
                            ))}
                          </div>
                        )}
                        <div className="mt-2">
                          <RequestActions id={r.id} status={r.status} canApprove={canApprove} custodian={custodian} own={own} />
                        </div>
                      </td>
                      <td className="px-4 py-4 text-ink-700">{r.project?.name ?? NO_PROJECT_LABEL}</td>
                      <td className="whitespace-nowrap px-4 py-4 text-right tabular-nums text-ink-900">{php(r.amount)}</td>
                      <td className="px-4 py-4">
                        <CashStatus status={r.status} label={PETTY_CASH_STATUS_LABEL[r.status]} />
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-ink-500">
                      No petty cash activity in this range.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  );
}
