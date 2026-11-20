import { php } from "@/lib/format";
import type { PayPeriodOption } from "@/lib/payroll-export";

const TZ = "Asia/Manila";
const md = new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric" });
const yr = (d: Date) => new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric" }).format(d);
const range = (p: PayPeriodOption) => `${md.format(p.periodStart)} – ${md.format(p.periodEnd)}, ${yr(p.periodEnd)}`;

function optionLabel(p: PayPeriodOption) {
  const names = p.runs.map((r) => r.name).join(", ");
  const waiting = p.waiting.length ? ` · ${p.waiting.length} not approved yet` : "";
  return `${range(p)} · ${names} · ${php(p.net)} net${waiting}`;
}

function DownloadRow({ kind, title, sub, periods }: { kind: "site" | "office"; title: string; sub: string; periods: PayPeriodOption[] }) {
  return (
    <form method="get" action="/api/payroll/export" className="flex flex-col gap-2 border-t border-dashed border-ink-200 py-3 first:border-t-0 sm:flex-row sm:items-center">
      <input type="hidden" name="kind" value={kind} />
      <div className="min-w-0 sm:w-56 sm:shrink-0">
        <div className="text-sm font-bold text-ink-900">{title}</div>
        <div className="text-[11px] text-ink-500">{sub}</div>
      </div>
      {periods.length === 0 ? (
        <p className="text-sm text-ink-400">No approved runs yet.</p>
      ) : (
        <>
          <select name="period" aria-label={`${title} — pay period`} defaultValue={periods[0].key} className="min-h-[42px] min-w-0 flex-1 rounded-full border border-ink-200 bg-ink-50 px-3 text-sm text-ink-900">
            {periods.map((p) => (
              <option key={p.key} value={p.key}>
                {optionLabel(p)}
              </option>
            ))}
          </select>
          <button type="submit" className="fx-grad min-h-[42px] shrink-0 rounded-full bg-accent px-5 text-sm font-semibold text-white hover:brightness-110">
            ⬇ Download Excel
          </button>
        </>
      )}
    </form>
  );
}

/** "Download payroll (Excel)" on the Payroll page: one workbook per pay period, site crews + drivers weekly, office semi-monthly. */
export function PayrollDownloadCard({ site, office }: { site: PayPeriodOption[]; office: PayPeriodOption[] }) {
  return (
    <section className="fx-card rounded-2xl border border-ink-200 bg-ink-50 px-3 py-2 sm:px-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 pt-1">
        <h2 className="text-[10px] font-bold uppercase tracking-[0.12em] text-ink-400">Download payroll (Excel)</h2>
        <span className="text-[11px] text-ink-500">Approved and paid runs only · a summary page + every run on one register</span>
      </div>
      <DownloadRow kind="site" title="Site crews & drivers" sub="weekly · every project + Drivers in one file" periods={site} />
      <DownloadRow kind="office" title="Office" sub="semi-monthly · separate file" periods={office} />
    </section>
  );
}
