import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fmtDate, php } from "@/lib/format";
import { normalizeEntries, type PayrollEntry } from "@/lib/payroll";
import { runGross } from "@/lib/finance";
import { CHARGEABLE_STATUSES } from "@/lib/project-status";
import { Badge, Card, CardBody, CardHeader, EmptyState, Table, Td, Th } from "@/components/ui";
import { ShareButton } from "@/components/share-button";
import { DeleteRunButton, RemoveEmployeeButton } from "@/components/payroll-actions";
import { ActionTile, CashStatus, CashStrip, SectionTitle } from "@/components/cash-expense-header";
import { AddEmployeeDialog, NewRunDialog } from "@/components/payroll-layout";
import { manilaDayKey, manilaSemiMonthlyPeriod, manilaWeeklySitePeriod } from "@/lib/time-rules";
import { ClassicPayrollAdmin } from "./classic-admin";
import { PayrollDownloadCard } from "@/components/payroll-download";
import { payPeriods } from "@/lib/payroll-export";

export const metadata = { title: "Payroll" };
export const dynamic = "force-dynamic";

/**
 * Payroll — separate per project (Spec 6.5 + owner's workflow). Each project
 * has its own employee roster (start date on the project + rate/hr) and its
 * own runs; approved runs post as labor into the project's committed cost.
 * Office staff and drivers, who have no project, run under Departments below.
 * Non-admin staff see only their own pay lines.
 */
export default async function PayrollPage({
  searchParams,
}: {
  searchParams: { layout?: string; q?: string; period?: string; status?: string };
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role === "CLIENT") redirect("/portal");

  // Generating runs / managing the roster stays Owner+Accounting; PM can see
  // this same admin view (read-only on those two actions) because PM can
  // edit a run's entries once inside it — canManageRuns gates the two forms
  // below, canViewAdminPayroll gates the whole admin layout vs. "My Pay".
  const canManageRuns = ["OWNER", "ACCOUNTING"].includes(user.role) || user.payrollAssist;
  const canViewAdminPayroll = ["OWNER", "ACCOUNTING", "PM"].includes(user.role) || user.payrollAssist;
  const canDeleteRuns = user.role === "OWNER";
  const runs = await prisma.payrollRun.findMany({
    orderBy: { periodStart: "desc" },
    include: { project: { select: { name: true } } },
  });

  if (!canViewAdminPayroll) {
    const myLines = runs
      .map((run) => {
        const entries = normalizeEntries(run.entries as unknown as PayrollEntry[]);
        const mine = entries.find((e) => e.userId === user.id);
        return mine ? { run, mine } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <h1 className="text-xl font-bold text-ink-900">My Pay</h1>
        <Card>
          <CardHeader title="My payslip history" subtitle="Only your own pay is visible to you" />
          {myLines.length === 0 ? (
            <CardBody>
              <EmptyState>No payroll records for you yet.</EmptyState>
            </CardBody>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Project / Dept</Th>
                  <Th>Period</Th>
                  <Th className="text-right">Hours (reg / OT)</Th>
                  <Th className="text-right">Net pay</Th>
                  <Th>Status</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {myLines.map(({ run, mine }) => (
                  <tr key={run.id}>
                    <Td className="text-xs">{run.project?.name ?? run.department}</Td>
                    <Td className="text-xs">
                      {fmtDate(run.periodStart)} – {fmtDate(run.periodEnd)}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {mine.regularHours} / {mine.otHours}
                    </Td>
                    <Td className="text-right font-semibold tabular-nums text-emerald-700">
                      {php(mine.net)}
                    </Td>
                    <Td>
                      <Badge value={run.status} />
                    </Td>
                    <Td className="text-right">
                      {run.status === "APPROVED" || run.status === "PAID" ? (
                        <span className="inline-flex items-center gap-3">
                          <a
                            href={`/api/payroll/${run.id}/payslips`}
                            className="text-xs font-medium text-brand-600 hover:underline"
                          >
                            ⬇ Payslip
                          </a>
                          <ShareButton src={`/api/payroll/${run.id}/payslips`} filename={`Payslip-${run.id.slice(-6)}.pdf`} title="Payslip" />
                        </span>
                      ) : (
                        <span className="text-xs text-ink-400">After approval</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    );
  }

  // ----- Admin view -----
  // The original layout stays one click away at /payroll?layout=classic — same data, same buttons, same permissions.
  if (searchParams.layout === "classic") {
    return (
      <div className="space-y-4">
        <div className="flex justify-end">
          <Link href="/payroll" className="text-xs font-semibold text-brand-600 hover:underline">
            Switch to the new layout →
          </Link>
        </div>
        <ClassicPayrollAdmin runs={runs} canManageRuns={canManageRuns} canDeleteRuns={canDeleteRuns} />
      </div>
    );
  }

  const [projects, employees] = await Promise.all([
    prisma.project.findMany({
      where: { status: { in: CHARGEABLE_STATUSES } },
      orderBy: { name: "asc" },
      include: {
        client: { select: { name: true } },
        assignments: {
          where: { active: true },
          orderBy: { user: { name: "asc" } },
          include: { user: { select: { id: true, name: true } } },
        },
      },
    }),
    prisma.user.findMany({
      where: { active: true, role: { not: "CLIENT" } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  type Run = (typeof runs)[number];
  const entriesOf = new Map(runs.map((r) => [r.id, normalizeEntries(r.entries as unknown as PayrollEntry[])]));
  const entries = (r: Run) => entriesOf.get(r.id) ?? [];
  const grossOf = (r: Run) => runGross(entries(r));
  const netOf = (r: Run) => entries(r).reduce((s, e) => s + e.net, 0);
  const isOpenRun = (r: Run) => r.status === "DRAFT" || r.status === "REVIEW";
  // "Oct 2 – Oct 9, 2026" (year once) so the period fits on one line on phones.
  const md = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", month: "short", day: "numeric" });
  const yr = (d: Date) => new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", year: "numeric" }).format(d);
  const range = (a: Date, b: Date) => (yr(a) === yr(b) ? `${md.format(a)} – ${md.format(b)}, ${yr(b)}` : `${fmtDate(a)} – ${fmtDate(b)}`);
  const label = (r: Run) => range(r.periodStart, r.periodEnd);

  // Periods: project crews run weekly (Fri–Fri), office semi-monthly. "This cut-off" = the last finished week or the current half-month.
  const now = new Date();
  const lastWeek = manilaWeeklySitePeriod(now, 1);
  const half = manilaSemiMonthlyPeriod(now);
  const cutoffStart = lastWeek.start < half.start ? lastWeek.start : half.start;
  const monthKey = manilaDayKey(now).slice(0, 7);
  const [my, mm] = monthKey.split("-").map(Number);
  const lastMonthKey = mm === 1 ? `${my - 1}-12` : `${my}-${String(mm - 1).padStart(2, "0")}`;
  const monthOf = (r: Run) => manilaDayKey(r.periodEnd).slice(0, 7);
  const coversLastWeek = (r: Run) => r.periodStart <= lastWeek.end && r.periodEnd >= lastWeek.start;

  // ----- Money strip + action tiles (whole payroll, not filtered) -----
  const laborMonth = runs.filter((r) => (r.status === "APPROVED" || r.status === "PAID") && monthOf(r) === monthKey).reduce((s, r) => s + grossOf(r), 0);
  const openRuns = runs.filter(isOpenRun);
  const toPay = runs.filter((r) => r.status === "APPROVED");
  const workers = new Set(projects.flatMap((p) => p.assignments.map((a) => a.userId))).size;
  const missingIds = new Set(projects.filter((p) => p.assignments.length > 0 && !runs.some((r) => r.projectId === p.id && coversLastWeek(r))).map((p) => p.id));
  const emptyIds = new Set(projects.filter((p) => p.assignments.length === 0).map((p) => p.id));
  const shortWeek = `${md.format(lastWeek.start)} – ${md.format(lastWeek.end)}`;

  // ----- Filters -----
  const q = (searchParams.q ?? "").trim().toLowerCase();
  const period = ["cutoff", "month", "last"].includes(searchParams.period ?? "") ? searchParams.period! : "";
  const status = ["DRAFT", "REVIEW", "APPROVED", "PAID", "open", "missing", "empty"].includes(searchParams.status ?? "") ? searchParams.status! : "";
  const filtered = !!(q || period || status);
  const href = (patch: Record<string, string>) => {
    const sp = new URLSearchParams();
    const merged = { q: searchParams.q ?? "", period, status, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) sp.set(k, v);
    const s = sp.toString();
    return s ? `/payroll?${s}` : "/payroll";
  };
  const periodOk = (r: Run) =>
    !period || (period === "cutoff" ? r.periodEnd >= cutoffStart : period === "month" ? monthOf(r) === monthKey : monthOf(r) === lastMonthKey);
  const statusOk = (r: Run) => (status === "open" ? isOpenRun(r) : ["DRAFT", "REVIEW", "APPROVED", "PAID"].includes(status) ? r.status === status : true);
  const runHit = (r: Run) => !q || `${label(r)} ${r.department ?? ""} ${entries(r).map((e) => e.name).join(" ")}`.toLowerCase().includes(q);
  const countOf = (s: string) => runs.filter((r) => periodOk(r) && runHit(r) && (s === "open" ? isOpenRun(r) : r.status === s)).length;

  interface Group {
    key: string;
    name: string;
    meta: string;
    projectId: string | null;
    allRuns: Run[];
    shown: Run[];
    project?: (typeof projects)[number];
  }
  const groups: Group[] = [];
  for (const p of projects) {
    const pr = runs.filter((r) => r.projectId === p.id);
    const projHit = !q || `${p.name} ${p.client.name} ${p.assignments.map((a) => a.user.name).join(" ")}`.toLowerCase().includes(q);
    const shown = pr.filter((r) => periodOk(r) && statusOk(r) && (projHit || runHit(r)));
    let visible: boolean;
    if (status === "missing") visible = missingIds.has(p.id) && (projHit || shown.length > 0);
    else if (status === "empty") visible = emptyIds.has(p.id) && projHit;
    else if (status || period) visible = shown.length > 0;
    else visible = projHit || shown.length > 0;
    if (!visible) continue;
    const labor = pr.filter((r) => r.status === "APPROVED" || r.status === "PAID").reduce((s, r) => s + grossOf(r), 0);
    groups.push({
      key: p.id,
      name: p.isNonCorporate ? `${p.name} · Non-corporate` : p.name,
      meta: `${p.client.name} · ${p.assignments.length} on roster · labor to date ${php(labor)}`,
      projectId: p.id,
      allRuns: pr,
      shown,
      project: p,
    });
  }
  // Runs waiting on you first, then approved-not-paid, then missing a run, then the rest (A–Z already).
  const rank = (g: Group) => (g.allRuns.some(isOpenRun) ? 0 : g.allRuns.some((r) => r.status === "APPROVED") ? 1 : missingIds.has(g.key) ? 2 : 3);
  groups.sort((a, b) => rank(a) - rank(b));

  // Office & Drivers (no project) — always the last group.
  const deptRuns = runs.filter((r) => !r.projectId);
  const officeHit = !q || "office drivers driver engineers architects no project".includes(q);
  const officeShown = deptRuns.filter((r) => periodOk(r) && statusOk(r) && (officeHit || runHit(r)));
  if (status !== "missing" && status !== "empty" && (filtered ? officeShown.length > 0 : true)) {
    groups.push({ key: "office", name: "Office & Drivers (no project)", meta: "semi-monthly · Office, Drivers, Engineers, Architects", projectId: null, allRuns: deptRuns, shown: officeShown });
  }

  const DEPT_NAME: Record<string, string> = { DRIVER: "Drivers", OFFICE: "Office", ENGINEER: "Engineers", ARCHITECT: "Architects", SITE: "Site" };
  const exportRuns = runs.map((r) => ({
    id: r.id,
    projectId: r.projectId,
    department: r.department,
    status: r.status,
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    name: r.project?.name ?? DEPT_NAME[r.department ?? ""] ?? r.department ?? "Payroll",
    net: netOf(r),
  }));

  const PREVIEW = 3;
  const projectOptions = projects.map((p) => ({ id: p.id, name: p.name }));

  const runRow = (r: Run, office: boolean) => (
    <div
      key={r.id}
      className="grid grid-cols-[minmax(0,1fr)_auto_28px] items-center gap-x-3 gap-y-0.5 border-t border-dashed border-ink-200 py-2.5 first:border-t-0 sm:grid-cols-[200px_minmax(0,1fr)_140px_100px_28px]"
    >
      <Link href={`/payroll/${r.id}`} className="truncate text-sm font-semibold text-brand-600 hover:underline">
        {office ? `${r.department} · ` : ""}
        {label(r)}
      </Link>
      <span className="col-start-1 row-start-2 truncate text-xs text-ink-500 sm:col-start-auto sm:row-start-auto">
        {entries(r).length} worker{entries(r).length === 1 ? "" : "s"}
      </span>
      <span className="col-start-2 row-start-1 text-right font-mono text-sm font-semibold text-ink-900 sm:col-start-auto sm:row-start-auto">
        {php(office ? netOf(r) : grossOf(r))}
        <span className="ml-1 font-sans text-[10px] font-normal text-ink-400">{office ? "net" : "gross"}</span>
      </span>
      <span className="col-start-2 row-start-2 justify-self-end sm:col-start-auto sm:row-start-auto sm:justify-self-start">
        <Badge value={r.status} />
      </span>
      <span className="col-start-3 row-span-2 row-start-1 text-right sm:col-start-auto sm:row-span-1 sm:row-start-auto">
        {canDeleteRuns && r.status !== "PAID" && (
          <details className="relative inline-block">
            <summary aria-label="More" className="cursor-pointer list-none rounded-lg px-1.5 text-lg leading-none text-ink-400 hover:bg-ink-100 [&::-webkit-details-marker]:hidden">
              ⋯
            </summary>
            <div className="absolute right-0 z-20 mt-1 rounded-xl border border-ink-200 bg-ink-50 p-1 shadow-lg">
              <DeleteRunButton runId={r.id} status={r.status} label={office ? `${r.department} ${label(r)}` : label(r)} />
            </div>
          </details>
        )}
      </span>
    </div>
  );

  const field = "min-h-[42px] rounded-full border border-ink-200 bg-ink-50 px-3 text-sm";
  const PERIOD_CHIPS = [
    { key: "", label: "All runs" },
    { key: "cutoff", label: "This cut-off" },
    { key: "month", label: "This month" },
    { key: "last", label: "Last month" },
  ];
  const STATUS_CHIPS: [string, string][] = [
    ["DRAFT", "Draft"],
    ["REVIEW", "Review"],
    ["APPROVED", "Approved"],
    ["PAID", "Paid"],
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-ink-900">Payroll</h1>
          <p className="text-sm text-ink-500">Each project keeps its own roster and runs · approved runs post as labor cost into that project&apos;s committed cost</p>
        </div>
        {canManageRuns && <NewRunDialog projects={projectOptions} />}
      </div>

      {/* 1 — money strip */}
      <CashStrip
        items={[
          { label: `Labor cost · ${new Date(`${monthKey}-01T00:00:00Z`).toLocaleString("en-US", { month: "short", timeZone: "UTC" })}`, value: php(laborMonth), sub: "approved + paid runs" },
          { label: "Waiting for approval", value: `${openRuns.length} run${openRuns.length === 1 ? "" : "s"}`, sub: `${php(openRuns.reduce((s, r) => s + grossOf(r), 0))} gross`, tone: openRuns.length ? "bad" : undefined },
          { label: "Approved, not paid", value: `${toPay.length} run${toPay.length === 1 ? "" : "s"}`, sub: `${php(toPay.reduce((s, r) => s + netOf(r), 0))} net` },
          { label: "Workers on rosters", value: workers, sub: `${projects.length} project${projects.length === 1 ? "" : "s"} + office` },
        ]}
      />

      {/* 2 — needs your action */}
      <div>
        <SectionTitle>Needs your action</SectionTitle>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <ActionTile href={href({ status: "open", period: "", q: "" })} count={openRuns.length} label="Runs to review / approve (draft or review)" sub={php(openRuns.reduce((s, r) => s + grossOf(r), 0))} cta="Review" />
          <ActionTile href={href({ status: "APPROVED", period: "", q: "" })} count={toPay.length} label="Approved, not yet paid" sub={php(toPay.reduce((s, r) => s + netOf(r), 0))} cta="Mark paid" />
          <ActionTile
            href={href({ status: "missing", period: "", q: "" })}
            count={missingIds.size}
            label={`Projects with no run for ${shortWeek}`}
            sub={projects.filter((p) => missingIds.has(p.id)).map((p) => p.name).slice(0, 2).join(" · ")}
            cta="Show"
            tone="warn"
          />
          <ActionTile href={href({ status: "empty", period: "", q: "" })} count={emptyIds.size} label="Projects with nobody on the roster" cta="Show" tone="warn" />
        </div>
      </div>

      {/* Excel download of a whole pay period (approved runs) */}
      <PayrollDownloadCard site={payPeriods(exportRuns, "site")} office={payPeriods(exportRuns, "office")} />

      {/* 3 — search + filters, 4 — runs folded per project */}
      <section className="fx-card min-w-0 overflow-hidden rounded-2xl border border-ink-200 bg-ink-50">
        <form method="get" action="/payroll" className="flex flex-wrap items-center gap-2 border-b border-ink-100 px-3 py-3 sm:px-4">
          {period && <input type="hidden" name="period" value={period} />}
          {status && <input type="hidden" name="status" value={status} />}
          <label className={`${field} flex min-w-[220px] flex-1 items-center gap-2 px-4`}>
            <span aria-hidden className="text-ink-400">
              ⌕
            </span>
            <input name="q" defaultValue={searchParams.q ?? ""} placeholder="Find a project, worker or pay period…" className="min-w-0 flex-1 bg-transparent text-ink-900 placeholder:text-ink-400 focus:outline-none" />
          </label>
          <button type="submit" className="fx-grad min-h-[42px] rounded-full bg-accent px-5 text-sm font-semibold text-white hover:brightness-110">
            Search
          </button>
          {filtered && (
            <Link href="/payroll" className="px-1 text-xs font-semibold text-brand-600 hover:underline">
              Clear
            </Link>
          )}
        </form>

        <div className="flex flex-wrap items-center gap-1.5 border-b border-ink-100 px-3 py-2.5 sm:px-4">
          {PERIOD_CHIPS.map((p) => (
            <Link key={p.key || "all"} href={href({ period: p.key })} className={`fx-pill ${period === p.key ? "fx-pill-on" : ""}`}>
              {p.label}
            </Link>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1.5 border-b border-ink-100 px-3 py-2.5 sm:px-4">
          <Link href={href({ status: "" })} className={`fx-pill ${!status ? "fx-pill-on" : ""}`}>
            All statuses
          </Link>
          {STATUS_CHIPS.map(([s, l]) => (
            <Link key={s} href={href({ status: s })} className={`fx-pill ${status === s ? "fx-pill-on" : ""}`}>
              {l} <span className="ml-1 font-mono">{countOf(s)}</span>
            </Link>
          ))}
          {status === "open" && <span className="fx-pill fx-pill-on">Draft + review</span>}
          {status === "missing" && <span className="fx-pill fx-pill-on">No run for {shortWeek}</span>}
          {status === "empty" && <span className="fx-pill fx-pill-on">Empty roster</span>}
        </div>

        {groups.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-ink-500">Nothing matches — try another period or clear the search.</p>
        ) : (
          groups.map((g, gi) => {
            const office = g.projectId === null;
            const nReview = g.allRuns.filter(isOpenRun).length;
            const nPay = g.allRuns.filter((r) => r.status === "APPROVED").length;
            const missing = missingIds.has(g.key);
            const empty = emptyIds.has(g.key);
            const open = filtered || groups.length === 1 || gi === 0;
            const head = g.shown.slice(0, filtered ? 12 : PREVIEW);
            const rest = g.shown.slice(head.length);
            const p = g.project;
            const rosterIds = new Set(p?.assignments.map((a) => a.userId) ?? []);
            const addable = employees.filter((e) => !rosterIds.has(e.id));
            return (
              <details key={g.key} open={open} className="group/grp border-b border-ink-100 last:border-b-0">
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-3 hover:bg-ink-100/40 sm:flex-nowrap sm:px-4 [&::-webkit-details-marker]:hidden">
                  <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-ink-100 text-[10px] text-ink-500 transition group-open/grp:rotate-90">
                    ▶
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-bold text-ink-900">{g.name}</span>
                    <span className="block truncate text-[11px] text-ink-500">{g.meta}</span>
                  </span>
                  <span className="flex w-full flex-wrap gap-1.5 pl-9 sm:ml-auto sm:w-auto sm:shrink-0 sm:justify-end sm:pl-0">
                    {nReview > 0 && <CashStatus status="PENDING" label={`${nReview} to review`} />}
                    {nPay > 0 && <CashStatus status="FOR_LIQUIDATION" label={`${nPay} to pay`} />}
                    {missing && <CashStatus status="REJECTED" label={`no run for ${shortWeek}`} />}
                    {empty && <CashStatus status="CANCELLED" label="nobody on roster" />}
                    {!nReview && !nPay && !missing && !empty && g.allRuns.length > 0 && <CashStatus status="LIQUIDATED" label="all paid ✓" />}
                  </span>
                </summary>

                <div className="px-3 pb-3 sm:pl-[52px] sm:pr-4">
                  <div className="mb-1 mt-1 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-ink-400">
                    Payroll runs
                    <span className="h-px flex-1 bg-ink-200" />
                    {p && (
                      <Link href={`/projects/${p.id}`} className="text-[11px] font-semibold normal-case tracking-normal text-brand-600 hover:underline">
                        View project →
                      </Link>
                    )}
                    {canManageRuns && <NewRunDialog small projects={projectOptions} initialProjectId={g.projectId ?? "__office__"} />}
                  </div>
                  {g.shown.length === 0 ? (
                    <p className="py-2 text-sm text-ink-400">{g.allRuns.length ? "No runs match the filter." : "No payroll runs yet."}</p>
                  ) : (
                    <>
                      {head.map((r) => runRow(r, office))}
                      {rest.length > 0 && (
                        <details className="group/more">
                          <summary className="cursor-pointer list-none py-2 text-xs font-semibold text-brand-600 group-open/more:hidden [&::-webkit-details-marker]:hidden">
                            Show {rest.length} older run{rest.length === 1 ? "" : "s"} ▾
                          </summary>
                          {rest.map((r) => runRow(r, office))}
                        </details>
                      )}
                    </>
                  )}

                  {p && (
                    <>
                      <div className="mb-1 mt-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-ink-400">
                        Roster · {p.assignments.length} worker{p.assignments.length === 1 ? "" : "s"}
                        <span className="h-px flex-1 bg-ink-200" />
                        {canManageRuns && <AddEmployeeDialog projectId={p.id} projectName={p.name} employees={addable} />}
                      </div>
                      {p.assignments.length === 0 ? (
                        <p className="py-1 text-sm text-ink-400">No employees yet — add them so payroll can be generated.</p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {p.assignments.map((a) => (
                            <span
                              key={a.id}
                              title={`Started on project ${fmtDate(a.startDate)}`}
                              className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-ink-50 py-1 pl-1 pr-2 text-xs text-ink-800"
                            >
                              <span aria-hidden className="fx-grad flex h-6 w-6 items-center justify-center rounded-full bg-accent text-[9px] font-bold text-white">
                                {a.user.name
                                  .split(/\s+/)
                                  .filter(Boolean)
                                  .slice(0, 2)
                                  .map((w) => w[0]?.toUpperCase())
                                  .join("")}
                              </span>
                              {a.user.name}
                              <span className="font-mono text-[10.5px] text-ink-400">{php(a.hourlyRate.toString())}/h</span>
                              <span className="hidden text-[10.5px] text-ink-400 sm:inline">· since {fmtDate(a.startDate)}</span>
                              {canManageRuns && <RemoveEmployeeButton assignmentId={a.id} name={a.user.name} />}
                            </span>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </details>
            );
          })
        )}
      </section>

      <p className="text-center text-xs text-ink-400">
        Prefer the old screen?{" "}
        <Link href="/payroll?layout=classic" className="font-semibold text-brand-600 hover:underline">
          Open the classic layout
        </Link>
      </p>
    </div>
  );
}
