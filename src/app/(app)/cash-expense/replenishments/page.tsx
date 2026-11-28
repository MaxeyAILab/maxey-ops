import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canUseCashExpense } from "@/lib/access";
import { php } from "@/lib/format";
import { manilaDayKey } from "@/lib/time-rules";
import { fundBalance, isCashCustodian, seesAllPettyCash } from "@/lib/cash-expense";
import { fundLedger, ledgerTotals, type LedgerRow } from "@/lib/fund-ledger";
import { CashExpenseHeader, CashStrip, SectionTitle } from "@/components/cash-expense-header";
import { FundForm } from "@/components/cash-expense-actions";

export const metadata = { title: "Fund Replenishments" };
export const dynamic = "force-dynamic";

const DAY_FMT = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", weekday: "short", month: "short", day: "numeric", year: "numeric" });
const TIME_FMT = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" });
const SHORT_FMT = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric" });
const MONTH_FMT = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", month: "long", year: "numeric" });

const isDay = (s: string | undefined) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const peso = (n: number) => `${n < 0 ? "−" : "+"}${php(Math.abs(n))}`;

const AVATAR_COLORS = ["#7c3aed", "#e0144c", "#0891b2", "#d97706", "#059669", "#db2777", "#2563eb", "#65a30d"];
const avatarColor = (name: string) => {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
};
const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

const PERIODS = [
  { key: "all", label: "All time" },
  { key: "month", label: "This month" },
  { key: "last", label: "Last month" },
  { key: "custom", label: "Dates…" },
] as const;

/**
 * Fund Replenishments — the audit trail of the petty cash fund (owner's request 2026-11-28): every time cash was added to the fund
 * (or corrected), the date and time, how much, who recorded it and why, and how much cash was in the fund right after. Entries are
 * never edited or deleted — a mistake is fixed with a correction entry, which shows here too. Same people who see the fund balance.
 */
export default async function FundReplenishmentsPage({
  searchParams,
}: {
  searchParams: { q?: string; period?: string; from?: string; to?: string; type?: string; by?: string };
}) {
  const user = await getSessionUser();
  if (!user || !canUseCashExpense(user)) redirect("/attendance");
  if (!seesAllPettyCash(user)) redirect("/cash-expense/petty-cash"); // only people who see the whole fund see how it was topped up
  const custodian = isCashCustodian(user);

  const now = new Date();
  const today = manilaDayKey(now);
  const thisMonth = today.slice(0, 7);
  const lastMonth = (() => {
    const [y, m] = thisMonth.split("-").map(Number);
    return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  })();
  const custom = isDay(searchParams.from) || isDay(searchParams.to);
  const period = custom ? "custom" : PERIODS.some((p) => p.key === searchParams.period) ? searchParams.period! : "all";
  const from = isDay(searchParams.from) ? searchParams.from! : "";
  const to = isDay(searchParams.to) ? searchParams.to! : "";
  const type = searchParams.type === "added" || searchParams.type === "correction" ? searchParams.type : "";
  const q = (searchParams.q ?? "").trim().slice(0, 80).toLowerCase();
  const by = searchParams.by ?? "";

  const [entries, requests] = await Promise.all([
    prisma.pettyCashFundEntry.findMany({ select: { id: true, amount: true, note: true, recordedById: true, recordedByName: true, createdAt: true } }),
    prisma.pettyCashRequest.findMany({ select: { status: true, amount: true, spentAmount: true, releasedAt: true, liquidatedAt: true } }),
  ]);
  const balance = fundBalance(entries, requests);
  const { rows: all, reconciled } = fundLedger(entries, requests); // oldest first, numbered over the whole history

  type Row = LedgerRow<(typeof entries)[number]>;
  const dayOf = (r: Row) => manilaDayKey(r.entry.createdAt);
  const inPeriod = (r: Row) =>
    period === "month" ? dayOf(r).startsWith(thisMonth) : period === "last" ? dayOf(r).startsWith(lastMonth) : period === "custom" ? (!from || dayOf(r) >= from) && (!to || dayOf(r) <= to) : true;
  const matches = (r: Row) =>
    !q || `${r.entry.note ?? ""} ${r.entry.recordedByName} ${r.amount} ${r.entry.createdAt.toISOString().slice(0, 10)} #${r.no}`.toLowerCase().includes(q);
  const listed = [...all]
    .filter((r) => inPeriod(r) && matches(r) && (!type || r.kind === type) && (!by || r.entry.recordedById === by))
    .reverse(); // newest first
  const filtered = !!(q || type || by || period !== "all");

  // strip
  const monthTotals = ledgerTotals(all.filter((r) => dayOf(r).startsWith(thisMonth)));
  const lastAdded = [...all].reverse().find((r) => r.kind === "added");
  const viewTotals = ledgerTotals(listed);
  const recorders = [...new Map(entries.map((e) => [e.recordedById, e.recordedByName])).entries()].sort((a, b) => a[1].localeCompare(b[1]));

  // folded by month (Manila), newest first
  const groups: { key: string; rows: Row[] }[] = [];
  for (const r of listed) {
    const key = dayOf(r).slice(0, 7);
    const g = groups.find((x) => x.key === key);
    if (g) g.rows.push(r);
    else groups.push({ key, rows: [r] });
  }
  const maxAdded = Math.max(1, ...groups.map((g) => ledgerTotals(g.rows).added));

  const href = (patch: Record<string, string>) => {
    const sp = new URLSearchParams();
    const merged: Record<string, string> = { q: searchParams.q ?? "", period: period === "all" ? "" : period, from, to, type, by, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) sp.set(k, v);
    const s = sp.toString();
    return s ? `/cash-expense/replenishments?${s}` : "/cash-expense/replenishments";
  };
  const field = "min-h-[42px] rounded-full border border-ink-200 bg-ink-50 px-3 text-sm";
  const lineCols = `grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 ${reconciled ? "sm:grid-cols-[52px_150px_190px_minmax(0,1fr)_130px_130px]" : "sm:grid-cols-[52px_150px_190px_minmax(0,1fr)_130px]"}`;

  return (
    <div className="space-y-5">
      <CashExpenseHeader tab="replenishments" title="Fund Replenishments" subtitle="Every time cash was added to the petty cash fund — when, how much, and who recorded it." showAdvances showFund />

      {/* 1 — money strip */}
      <CashStrip
        items={[
          { label: "Available petty cash", value: php(balance), tone: "good", sub: custodian ? <FundForm /> : "right now" },
          { label: "Added this month", value: php(monthTotals.added), sub: `${monthTotals.addedCount} replenishment${monthTotals.addedCount === 1 ? "" : "s"}${monthTotals.correctionCount ? ` · ${monthTotals.correctionCount} correction${monthTotals.correctionCount === 1 ? "" : "s"}` : ""}` },
          lastAdded
            ? { label: "Last replenished", value: php(lastAdded.amount), sub: `${SHORT_FMT.format(lastAdded.entry.createdAt)} · ${lastAdded.entry.recordedByName.split(" ")[0]}` }
            : { label: "Last replenished", value: "—", sub: "nothing added yet" },
          { label: filtered ? "Added in this view" : "Added, all time", value: php(viewTotals.added), sub: `${viewTotals.addedCount} replenishment${viewTotals.addedCount === 1 ? "" : "s"}${viewTotals.correctionCount ? ` · ${php(viewTotals.corrections)} in corrections` : ""}` },
        ]}
      />

      {/* 2 — search + filters, 3 — the trail folded by month */}
      <section className="fx-card min-w-0 overflow-hidden rounded-2xl border border-ink-200 bg-ink-50">
        <form method="get" action="/cash-expense/replenishments" className="flex flex-wrap items-center gap-2 border-b border-ink-100 px-3 py-3 sm:px-4">
          {period !== "all" && period !== "custom" && <input type="hidden" name="period" value={period} />}
          {period === "custom" && <input type="hidden" name="period" value="custom" />}
          {type && <input type="hidden" name="type" value={type} />}
          <label className={`${field} flex min-w-[220px] flex-[2] items-center gap-2 px-4`}>
            <span aria-hidden className="text-ink-400">
              ⌕
            </span>
            <input name="q" defaultValue={searchParams.q ?? ""} placeholder="Find a note, person or amount…" className="min-w-0 flex-1 bg-transparent text-ink-900 placeholder:text-ink-400 focus:outline-none" />
          </label>
          {recorders.length > 1 && (
            <select name="by" defaultValue={by} aria-label="Recorded by" className={`${field} min-w-[170px] flex-1`}>
              <option value="">Anyone recorded</option>
              {recorders.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          )}
          {period === "custom" && (
            <>
              <input type="date" name="from" defaultValue={from} aria-label="From" className={field} />
              <input type="date" name="to" defaultValue={to} aria-label="To" className={field} />
            </>
          )}
          <button type="submit" className="fx-grad min-h-[42px] rounded-full bg-accent px-5 text-sm font-semibold text-white hover:brightness-110">
            Search
          </button>
          {filtered && (
            <Link href="/cash-expense/replenishments" className="px-1 text-xs font-semibold text-brand-600 hover:underline">
              Clear
            </Link>
          )}
        </form>

        <div className="flex items-center gap-1.5 overflow-x-auto whitespace-nowrap border-b border-ink-100 px-3 py-2.5 sm:flex-wrap sm:px-4 [&::-webkit-scrollbar]:hidden">
          {PERIODS.map((p) => (
            <Link key={p.key} href={href({ period: p.key === "all" ? "" : p.key, from: "", to: "" })} scroll={false} className={`fx-pill ${period === p.key ? "fx-pill-on" : ""}`}>
              {p.label}
            </Link>
          ))}
          <span className="mx-1 h-5 w-px bg-ink-200" />
          {[
            ["", "All entries"],
            ["added", "Replenishments"],
            ["correction", "Corrections"],
          ].map(([k, l]) => (
            <Link key={k || "all"} href={href({ type: k })} scroll={false} className={`fx-pill ${type === k ? "fx-pill-on" : ""}`}>
              {l}
            </Link>
          ))}
        </div>

        {groups.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-ink-500">{entries.length === 0 ? "No cash has been added to the fund yet." : "Nothing matches — try another period or clear the search."}</p>
        ) : (
          groups.map((g, gi) => {
            const t = ledgerTotals(g.rows);
            const pct = Math.round((t.added / maxAdded) * 100);
            return (
              <details key={g.key} open={filtered || gi < 2} className="group/grp border-b border-ink-100 last:border-b-0">
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-3 hover:bg-ink-100/40 sm:flex-nowrap sm:px-4 [&::-webkit-details-marker]:hidden">
                  <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-ink-100 text-[10px] text-ink-500 transition group-open/grp:rotate-90">
                    ▶
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-bold text-ink-900">{MONTH_FMT.format(new Date(`${g.key}-15T00:00:00+08:00`))}</span>
                    <span className="block truncate text-[11px] text-ink-500">
                      {t.addedCount} replenishment{t.addedCount === 1 ? "" : "s"}
                      {t.correctionCount > 0 && ` · ${t.correctionCount} correction${t.correctionCount === 1 ? "" : "s"}`}
                    </span>
                  </span>
                  <span className="flex w-full items-center gap-3 pl-9 sm:ml-auto sm:w-auto sm:shrink-0 sm:pl-0">
                    <span className="hidden h-1.5 w-28 overflow-hidden rounded-full bg-ink-200 sm:block">
                      <span className="block h-full bg-emerald-500" style={{ width: `${pct}%` }} />
                    </span>
                    <span className="fx-ok font-mono text-sm font-bold">{peso(t.added)}</span>
                    {t.corrections !== 0 && <span className="font-mono text-xs font-semibold text-red-600 dark:text-red-300">{peso(t.corrections)} corrected</span>}
                  </span>
                </summary>
                <div className="px-3 pb-2 sm:pl-[52px] sm:pr-4">
                  <div className={`hidden pb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-ink-400 sm:grid ${lineCols}`}>
                    <span>No.</span>
                    <span>When</span>
                    <span>Recorded by</span>
                    <span>Note</span>
                    <span className="text-right">Added to fund</span>
                    {reconciled && <span className="text-right" title="Cash in the fund right after this entry — counting cash already released and change returned up to then">Fund after</span>}
                  </div>
                  {g.rows.map((r) => {
                    const name = r.entry.recordedByName;
                    return (
                      <div key={r.entry.id} className={`${lineCols} items-center border-t border-dashed border-ink-200 py-2.5 first:border-t-0`}>
                        <span className="hidden font-mono text-[11px] text-ink-400 sm:block">#{r.no}</span>
                        <span className="col-start-1 min-w-0 sm:col-start-auto">
                          <span className="block text-sm font-semibold text-ink-900">{DAY_FMT.format(r.entry.createdAt)}</span>
                          <span className="block font-mono text-[11px] text-ink-500">
                            <span className="sm:hidden">#{r.no} · </span>
                            {TIME_FMT.format(r.entry.createdAt)}
                          </span>
                        </span>
                        <span className="col-start-1 flex min-w-0 items-center gap-2 sm:col-start-auto">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white" style={{ backgroundColor: avatarColor(name) }}>
                            {initials(name)}
                          </span>
                          <span className="truncate text-xs text-ink-700">{name}</span>
                        </span>
                        <span className="col-start-1 min-w-0 sm:col-start-auto">
                          {r.kind === "correction" && <span className="mr-1.5 rounded-full bg-red-100 px-2 py-0.5 text-[10.5px] font-semibold text-red-700 dark:bg-red-900/40 dark:text-red-300">Correction</span>}
                          {r.entry.note ? <span className="text-xs text-ink-700">{r.entry.note}</span> : <span className="text-xs italic text-ink-300">no note recorded</span>}
                        </span>
                        <span className={`col-start-2 row-start-1 row-span-2 self-start text-right font-mono text-sm font-bold sm:col-start-auto sm:row-start-auto sm:row-span-1 sm:self-center ${r.kind === "added" ? "fx-ok" : "text-red-600 dark:text-red-300"}`}>
                          {peso(r.amount)}
                          {reconciled && r.balanceAfter != null && (
                            <span className="mt-0.5 block font-sans text-[10.5px] font-normal text-ink-400 sm:hidden">fund after {php(r.balanceAfter)}</span>
                          )}
                        </span>
                        {reconciled && <span className="hidden text-right font-mono text-xs text-ink-500 sm:block">{r.balanceAfter != null ? php(r.balanceAfter) : "—"}</span>}
                      </div>
                    );
                  })}
                </div>
              </details>
            );
          })
        )}
      </section>

      <div>
        <SectionTitle>How to read this</SectionTitle>
        <ul className="space-y-1.5 text-xs text-ink-600">
          <li>
            <b>Added to fund</b> is the cash put into the petty cash fund by that entry. {reconciled ? <><b>Fund after</b> is the cash in the fund right after it — counting cash already released and change returned up to that moment.</> : null}
          </li>
          <li>Entries can&apos;t be edited or deleted. To fix a mistake, add a correction (a negative amount) with <b>+ Replenish fund</b> — it appears here in red and in the audit log.</li>
          <li>Every new entry needs a note — where the cash came from (e.g. “Check #1023 encashed”, “Cash from the Owner”) or why it is corrected.{entries.some((e) => !e.note) ? " Older entries made before this rule may show “no note recorded”." : ""}</li>
        </ul>
      </div>
    </div>
  );
}
