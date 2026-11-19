import Link from "next/link";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canUseCashExpense } from "@/lib/access";
import { fmtDate, php } from "@/lib/format";
import { manilaDayKey } from "@/lib/time-rules";
import {
  canApproveCash,
  canApprovePettyCash,
  canReleasePettyCash,
  formatPettyCashNo,
  fundBalance,
  isCashCustodian,
  missingReceipt,
  NO_PROJECT,
  NO_PROJECT_LABEL,
  PETTY_CASH_CATEGORY_LABEL,
  PETTY_CASH_STATUS_LABEL,
  seesAllPettyCash,
  unliquidated,
} from "@/lib/cash-expense";
import { ActionTile, CashExpenseHeader, CashStatus, CashStrip, SectionTitle } from "@/components/cash-expense-header";
import { FundForm, NoReceiptFlag, QuickRecordForm, RequestActions } from "@/components/cash-expense-actions";
import { NewRequestDialog } from "@/components/cash-expense-layout";

export const metadata = { title: "Petty Cash" };
export const dynamic = "force-dynamic";

const DAY_FMT = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric" });
const TIME_FMT = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Start of the Manila calendar month containing `d`. */
function manilaMonthStart(d: Date) {
  return new Date(`${manilaDayKey(d).slice(0, 7)}-01T00:00:00+08:00`);
}

const isDay = (s: string | undefined) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

const PERIODS = [
  { key: "7d", label: "Last 7 days" },
  { key: "month", label: "This month" },
  { key: "last", label: "Last month" },
  { key: "all", label: "All time" },
] as const;

/** Groups with more rows than this show the rest behind "Show N more". */
const GROUP_PREVIEW = 8;

export default async function PettyCashPage({
  searchParams,
}: {
  searchParams: { status?: string; from?: string; to?: string; q?: string; period?: string; project?: string };
}) {
  const user = await getSessionUser();
  if (!user || !canUseCashExpense(user)) redirect("/attendance");
  const custodian = isCashCustodian(user);
  const canApprove = canApprovePettyCash(user);
  const canRelease = canReleasePettyCash(user);
  const canDelete = canApproveCash(user); // Owner only
  const seesAll = seesAllPettyCash(user);

  // Period: quick choices, or a custom From/To (older links still pass from/to).
  const now = new Date();
  const today = manilaDayKey(now);
  const custom = isDay(searchParams.from) || isDay(searchParams.to);
  const period = custom ? "custom" : PERIODS.some((p) => p.key === searchParams.period) ? searchParams.period! : "month";
  const thisMonth = today.slice(0, 7);
  const thisMonthStart = new Date(`${thisMonth}-01T00:00:00+08:00`);
  const lastMonthEnd = manilaDayKey(new Date(thisMonthStart.getTime() - 86_400_000));
  const lastMonthStart = `${lastMonthEnd.slice(0, 7)}-01`;
  const [from, to] =
    period === "custom"
      ? [isDay(searchParams.from) ? searchParams.from! : "2000-01-01", isDay(searchParams.to) ? searchParams.to! : today]
      : period === "7d"
        ? [manilaDayKey(new Date(now.getTime() - 6 * 86_400_000)), today]
        : period === "last"
          ? [lastMonthStart, lastMonthEnd]
          : period === "all"
            ? ["2000-01-01", today]
            : [`${thisMonth}-01`, today];
  const status = searchParams.status && PETTY_CASH_STATUS_LABEL[searchParams.status] ? searchParams.status : "";
  const q = (searchParams.q ?? "").trim().slice(0, 80);
  const projectFilter = searchParams.project ?? "";

  // Everyone but the custodians, approvers and releasers only ever sees requests they filed or that are theirs.
  const mine: Prisma.PettyCashRequestWhereInput = seesAll ? {} : { OR: [{ requestedById: user.id }, { createdById: user.id }] };
  const numberMatch = /^(?:pc-?)?0*(\d{1,6})$/i.exec(q);
  const base: Prisma.PettyCashRequestWhereInput[] = [
    mine,
    { createdAt: { gte: new Date(`${from}T00:00:00+08:00`), lte: new Date(`${to}T23:59:59.999+08:00`) } },
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
  ];
  const where: Prisma.PettyCashRequestWhereInput = { AND: [...base, status ? { status: status as never } : {}] };

  const monthStart = manilaMonthStart(now);
  const [rows, statusCounts, all, fund, projects, people] = await Promise.all([
    prisma.pettyCashRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 300,
      include: { project: { select: { name: true } }, requestedBy: { select: { name: true } } },
    }),
    prisma.pettyCashRequest.groupBy({ by: ["status"], where: { AND: base }, _count: { _all: true } }),
    prisma.pettyCashRequest.findMany({
      where: seesAll ? {} : mine,
      select: { status: true, amount: true, spentAmount: true, releasedAt: true, receivedAt: true, requestedById: true, liquidationReceipts: true },
    }),
    seesAll ? prisma.pettyCashFundEntry.findMany({ select: { amount: true } }) : Promise.resolve([]),
    prisma.project.findMany({
      where: { status: { not: "NOT_ACTIVE" } },
      select: { id: true, name: true, isNonCorporate: true },
      orderBy: { name: "asc" },
    }),
    custodian
      ? prisma.user.findMany({ where: { active: true, role: { not: "CLIENT" } }, select: { id: true, name: true }, orderBy: { name: "asc" } })
      : Promise.resolve([]),
  ]);

  const balance = seesAll ? fundBalance(fund, all) : 0;
  const pendingRows = all.filter((r) => r.status === "PENDING");
  const approvedRows = all.filter((r) => r.status === "APPROVED");
  const releasedThisMonthRows = all.filter((r) => r.releasedAt && r.releasedAt >= monthStart);
  const releasedThisMonth = releasedThisMonthRows.reduce((s, r) => s + Number(r.amount), 0);
  const outstanding = all.reduce((s, r) => s + unliquidated(r), 0);
  const notConfirmed = all.filter((r) => r.status === "RELEASED" && !r.receivedAt && (seesAll || r.requestedById === user.id));
  const missingCount = all.filter(missingReceipt).length;
  const sum = (list: { amount: unknown }[]) => php(list.reduce((s, r) => s + Number(r.amount), 0));

  const projectGroups = [
    { group: "Projects", options: projects.filter((p) => !p.isNonCorporate).map((p) => ({ value: p.id, label: p.name })) },
    { group: "Non-corporate jobs", options: projects.filter((p) => p.isNonCorporate).map((p) => ({ value: p.id, label: p.name })) },
    { group: "No project", options: [{ value: NO_PROJECT, label: `${NO_PROJECT_LABEL} (no project)` }] },
  ].filter((g) => g.options.length > 0);

  // Status chip counts (for the current period / search / project, before the status filter).
  const countOf = (s: string) => statusCounts.find((c) => c.status === s)?._count._all ?? 0;
  const totalCount = statusCounts.reduce((s, c) => s + c._count._all, 0);

  type Row = (typeof rows)[number];
  // A row that waits on this person: its group opens first, and — in a list picked from a tile/status chip — the row itself opens with its buttons showing.
  const needsMe = (r: Row) =>
    (r.status === "PENDING" && canApprove) || (r.status === "APPROVED" && canRelease) || (r.status === "RELEASED" && !r.receivedAt && r.requestedById === user.id);
  const isOpenItem = (s: string) => s === "PENDING" || s === "APPROVED" || s === "RELEASED" || s === "FOR_LIQUIDATION";

  // Group by project; groups with something waiting on you first, General & Administrative last.
  const groupMap = new Map<string, { key: string; name: string; rows: Row[] }>();
  for (const r of rows) {
    const key = r.projectId ?? NO_PROJECT;
    const g = groupMap.get(key) ?? { key, name: r.project?.name ?? NO_PROJECT_LABEL, rows: [] };
    g.rows.push(r);
    groupMap.set(key, g);
  }
  const waits = (g: { rows: Row[] }) => g.rows.some(needsMe);
  const groups = [...groupMap.values()].sort((a, b) => {
    const d = (waits(a) ? 0 : 1) - (waits(b) ? 0 : 1);
    if (d) return d;
    if (a.key === NO_PROJECT) return 1;
    if (b.key === NO_PROJECT) return -1;
    return a.name.localeCompare(b.name);
  });
  const filtered = !!(q || status || projectFilter);

  // Links that keep the other filters.
  const href = (next: Record<string, string>) => {
    const cur: Record<string, string> = {
      period: period === "custom" || period === "month" ? "" : period,
      from: period === "custom" ? from : "",
      to: period === "custom" ? to : "",
      status,
      q,
      project: projectFilter,
    };
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...cur, ...next })) if (v) sp.set(k, v);
    const s = sp.toString();
    return `/cash-expense/petty-cash${s ? `?${s}` : ""}`;
  };

  const row = (r: Row) => {
    const own = r.requestedById === user.id || r.createdById === user.id;
    return (
      <details key={r.id} open={!!status && needsMe(r)} className="group/row border-t border-dashed border-ink-200 first:border-t-0">
        <summary className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 py-2.5 sm:grid-cols-[52px_70px_minmax(0,1fr)_150px_110px_120px_16px] [&::-webkit-details-marker]:hidden">
          <span className="hidden font-mono text-xs text-ink-500 sm:block">{DAY_FMT.format(r.createdAt)}</span>
          <span className="hidden font-mono text-xs text-ink-500 sm:block">{formatPettyCashNo(r.number)}</span>
          <span className="row-start-1 min-w-0 truncate font-semibold text-ink-900 sm:row-auto">
            {r.purpose}
            {missingReceipt(r) && <span className="ml-2 align-middle text-[10px] font-bold text-accent">NO RECEIPT</span>}
          </span>
          <span className="row-start-2 truncate text-xs text-ink-500 sm:row-auto">
            <span className="sm:hidden">{formatPettyCashNo(r.number)} · </span>
            {r.requestedBy.name}
          </span>
          <span className="col-start-2 row-start-1 text-right font-mono font-bold text-ink-900 sm:col-auto sm:row-auto">{php(r.amount)}</span>
          <span className="col-start-2 row-start-2 justify-self-end sm:col-auto sm:row-auto sm:justify-self-start">
            <span className="whitespace-nowrap">
              <CashStatus status={r.status} label={r.status === "RELEASED" && r.receivedAt ? "Received" : PETTY_CASH_STATUS_LABEL[r.status]} />
            </span>
          </span>
          <span aria-hidden className="hidden text-center font-bold text-ink-400 transition group-open/row:rotate-90 sm:block">
            ›
          </span>
        </summary>
        <div className="mb-2.5 space-y-1.5 rounded-xl border border-ink-200 bg-ink-100/50 px-3.5 py-3 text-xs text-ink-600">
          <div>
            {TIME_FMT.format(r.createdAt)} · {formatPettyCashNo(r.number)} · {PETTY_CASH_CATEGORY_LABEL[r.category]} · {r.requestedBy.name}
          </div>
          {r.status === "RELEASED" && (
            <div>
              Released by {r.releasedByName ?? "—"} · {r.receivedAt ? `received by ${r.requestedBy.name} ${TIME_FMT.format(r.receivedAt)}` : `waiting for ${r.requestedBy.name} to confirm receipt`}
            </div>
          )}
          {missingReceipt(r) && (
            <div className="flex flex-wrap items-center gap-2">
              <NoReceiptFlag />
              <a href="/cash-expense/report#missing-receipts" className="font-medium text-accent hover:underline dark:text-rose-300">
                Attach it on the Petty Cash Report →
              </a>
            </div>
          )}
          {r.status === "REJECTED" && r.rejectedReason && <div className="text-red-700 dark:text-red-300">Rejected: {r.rejectedReason}</div>}
          {Array.isArray(r.receipts) && (r.receipts as string[]).length > 0 && (
            <div className="flex gap-2">
              {(r.receipts as string[]).map((src, i) => (
                <a key={src} href={src} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline dark:text-rose-300">
                  Receipt {i + 1}
                </a>
              ))}
            </div>
          )}
          <div className="pt-1">
            <RequestActions
              id={r.id}
              status={r.status}
              canApprove={canApprove}
              canRelease={canRelease}
              canDelete={canDelete}
              custodian={custodian}
              own={own}
              isRequester={r.requestedById === user.id}
              received={!!r.receivedAt}
            />
          </div>
        </div>
      </details>
    );
  };

  const field = "min-h-[42px] rounded-full border border-ink-200 bg-ink-50 px-3 text-sm";

  return (
    <div className="space-y-5">
      <CashExpenseHeader
        tab="petty-cash"
        title="Petty Cash"
        subtitle="Requests, releases and the running balance."
        showAdvances
        action={
          <NewRequestDialog>
            <QuickRecordForm
              projects={projectGroups}
              people={people.map((p) => ({ value: p.id, label: p.name }))}
              me={{ value: user.id, label: user.name }}
              canPickRequester={custodian}
            />
          </NewRequestDialog>
        }
      />

      {/* 1 — money strip */}
      <CashStrip
        items={[
          seesAll
            ? { label: "Available petty cash", value: php(balance), tone: "good", sub: custodian ? <FundForm /> : undefined }
            : { label: "My requests (all time)", value: all.length },
          { label: seesAll ? "Pending" : "My pending", value: pendingRows.length, sub: sum(pendingRows) },
          { label: "Released this month", value: php(releasedThisMonth), sub: `${releasedThisMonthRows.length} request${releasedThisMonthRows.length === 1 ? "" : "s"}` },
          { label: "Unliquidated", value: php(outstanding), tone: outstanding > 0 ? "bad" : undefined, sub: "Released, receipts not yet verified" },
        ]}
      />

      {/* 2 — needs your action */}
      <div>
        <SectionTitle>Needs your action</SectionTitle>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {canApprove ? (
            <ActionTile href="/cash-expense/petty-cash?status=PENDING&period=all" count={pendingRows.length} label="Requests to approve" sub={sum(pendingRows)} cta="Approve" />
          ) : (
            <ActionTile href="/cash-expense/petty-cash?status=PENDING&period=all" count={pendingRows.length} label="My requests waiting for approval" sub={sum(pendingRows)} cta="Show" tone="warn" />
          )}
          {canRelease && (
            <ActionTile href="/cash-expense/petty-cash?status=APPROVED&period=all" count={approvedRows.length} label="Approved, cash not released" sub={sum(approvedRows)} cta="Release" />
          )}
          <ActionTile href="/cash-expense/report#missing-receipts" count={missingCount} label="Missing receipts" sub="attach on the Petty Cash Report" cta="Show" tone="warn" />
          <ActionTile
            href="/cash-expense/petty-cash?status=RELEASED&period=all"
            count={notConfirmed.length}
            label={seesAll ? "Released, receipt of cash not confirmed" : "Confirm you received the cash"}
            sub={sum(notConfirmed)}
            cta={seesAll ? "Show" : "Confirm"}
            tone={seesAll ? "warn" : "hot"}
          />
        </div>
      </div>

      {/* 3 — search + filters, 4 — requests folded per project */}
      <section className="fx-card min-w-0 overflow-hidden rounded-2xl border border-ink-200 bg-ink-50">
        <form method="get" action="/cash-expense/petty-cash" className="flex flex-wrap items-center gap-2 border-b border-ink-100 px-3 py-3 sm:px-4">
          {period !== "month" && period !== "custom" && <input type="hidden" name="period" value={period} />}
          {period === "custom" && (
            <>
              <input type="hidden" name="from" value={from} />
              <input type="hidden" name="to" value={to} />
            </>
          )}
          {status && <input type="hidden" name="status" value={status} />}
          <label className={`${field} flex min-w-[220px] flex-1 items-center gap-2 px-4`}>
            <span aria-hidden className="text-ink-400">
              ⌕
            </span>
            <input name="q" defaultValue={q} placeholder="Search PC no., purpose, person or project…" className="min-w-0 flex-1 bg-transparent text-ink-900 placeholder:text-ink-400 focus:outline-none" />
          </label>
          <select name="project" defaultValue={projectFilter} aria-label="Project" className={`${field} max-w-full font-semibold text-ink-700 sm:max-w-[230px]`}>
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            <option value={NO_PROJECT}>{NO_PROJECT_LABEL}</option>
          </select>
          <button type="submit" className="fx-grad min-h-[42px] rounded-full bg-accent px-5 text-sm font-semibold text-white hover:brightness-110">
            Search
          </button>
          {filtered && (
            <Link href={href({ q: "", status: "", project: "" })} className="px-1 text-xs font-semibold text-brand-600 hover:underline">
              Clear
            </Link>
          )}
        </form>

        <div className="flex flex-wrap items-center gap-1.5 border-b border-ink-100 px-3 py-2.5 sm:px-4">
          {PERIODS.map((p) => (
            <Link key={p.key} href={href({ period: p.key === "month" ? "" : p.key, from: "", to: "" })} className={`fx-pill ${period === p.key ? "fx-pill-on" : ""}`}>
              {p.label}
            </Link>
          ))}
          <details className="relative">
            <summary className={`fx-pill cursor-pointer list-none [&::-webkit-details-marker]:hidden ${period === "custom" ? "fx-pill-on" : ""}`}>
              {period === "custom" ? `${from === "2000-01-01" ? "…" : fmtDate(from)} – ${fmtDate(to)}` : "Custom…"}
            </summary>
            <form method="get" action="/cash-expense/petty-cash" className="absolute left-0 z-20 mt-2 flex w-64 flex-col gap-2 rounded-xl border border-ink-200 bg-ink-50 p-3 shadow-lg">
              {status && <input type="hidden" name="status" value={status} />}
              {q && <input type="hidden" name="q" value={q} />}
              {projectFilter && <input type="hidden" name="project" value={projectFilter} />}
              <label className="text-xs text-ink-600">
                From
                <input type="date" name="from" defaultValue={period === "custom" && from !== "2000-01-01" ? from : `${thisMonth}-01`} className="mt-1 block min-h-[40px] w-full rounded-lg border border-ink-200 bg-ink-50 px-2 text-ink-900" />
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
        </div>

        <div className="flex flex-wrap items-center gap-1.5 border-b border-ink-100 px-3 py-2.5 sm:px-4">
          <Link href={href({ status: "" })} className={`fx-pill ${!status ? "fx-pill-on" : ""}`}>
            All <span className="ml-1 font-mono">{totalCount}</span>
          </Link>
          {Object.entries(PETTY_CASH_STATUS_LABEL)
            .filter(([s]) => countOf(s) > 0 || s === status)
            .map(([s, label]) => (
              <Link key={s} href={href({ status: s })} className={`fx-pill ${status === s ? "fx-pill-on" : ""}`}>
                {label} <span className="ml-1 font-mono">{countOf(s)}</span>
              </Link>
            ))}
          {seesAll && (
            <span className="ml-auto hidden text-xs text-ink-500 sm:inline">
              Running balance <b className="font-mono text-ink-900">{php(balance)}</b>
            </span>
          )}
        </div>

        {groups.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-ink-500">No petty cash requests match — try another period or clear the search.</p>
        ) : (
          groups.map((g, gi) => {
            const n = (s: string) => g.rows.filter((r) => r.status === s).length;
            const open = filtered || groups.length === 1 || gi === 0; // the first group is the one that waits on you most (sorted above)
            const head = g.rows.slice(0, GROUP_PREVIEW);
            const rest = g.rows.slice(GROUP_PREVIEW);
            const noReceipt = g.rows.filter(missingReceipt).length;
            return (
              <details key={g.key} open={open} className="group/grp border-b border-ink-100 last:border-b-0">
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-3 hover:bg-ink-100/40 sm:flex-nowrap sm:px-4 [&::-webkit-details-marker]:hidden">
                  <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-ink-100 text-[10px] text-ink-500 transition group-open/grp:rotate-90">
                    ▶
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-bold text-ink-900">{g.name}</span>
                    <span className="block text-[11px] text-ink-500">
                      {g.rows.length} request{g.rows.length === 1 ? "" : "s"} · <span className="font-mono">{php(g.rows.reduce((s, r) => s + Number(r.amount), 0))}</span>
                      {g.key === NO_PROJECT && " · company overhead"}
                    </span>
                  </span>
                  <span className="flex w-full flex-wrap gap-1.5 pl-9 sm:ml-auto sm:w-auto sm:shrink-0 sm:justify-end sm:pl-0">
                    {n("PENDING") > 0 && <CashStatus status="PENDING" label={`${n("PENDING")} pending`} />}
                    {n("APPROVED") > 0 && <CashStatus status="APPROVED" label={`${n("APPROVED")} to release`} />}
                    {n("RELEASED") > 0 && (
                      <span className="hidden sm:inline">
                        <CashStatus status="RELEASED" label={`${n("RELEASED")} released`} />
                      </span>
                    )}
                    {noReceipt > 0 && <CashStatus status="REJECTED" label={`${noReceipt} no receipt`} />}
                    {!g.rows.some((r) => isOpenItem(r.status)) && noReceipt === 0 && <CashStatus status="LIQUIDATED" label="all closed ✓" />}
                  </span>
                </summary>
                <div className="px-3 pb-2 sm:pl-[52px] sm:pr-4">
                  {head.map(row)}
                  {rest.length > 0 && (
                    <details className="group/more">
                      <summary className="cursor-pointer list-none py-2 text-xs font-semibold text-brand-600 group-open/more:hidden [&::-webkit-details-marker]:hidden">
                        Show {rest.length} more ▾
                      </summary>
                      {rest.map(row)}
                    </details>
                  )}
                </div>
              </details>
            );
          })
        )}
        {rows.length >= 300 && <p className="border-t border-ink-100 px-4 py-2 text-xs text-ink-500">Showing the latest 300 — narrow the period or search to see older ones.</p>}
      </section>
    </div>
  );
}
