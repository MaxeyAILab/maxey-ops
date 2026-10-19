import Link from "next/link";
import { LiveUpdates } from "@/components/cash-expense-actions";

const TABS = [
  { key: "petty-cash", href: "/cash-expense/petty-cash", label: "Petty Cash" },
  { key: "cash-advance", href: "/cash-expense/cash-advance", label: "Cash Advance" },
  { key: "report", href: "/cash-expense/report", label: "Petty Cash Report" },
] as const;

export type CashExpenseTab = (typeof TABS)[number]["key"];

/** Breadcrumb, title, live indicator and the three section tabs shared by every Cash Expense page. */
export function CashExpenseHeader({
  tab,
  title,
  subtitle,
  showAdvances,
  action,
}: {
  tab: CashExpenseTab;
  title: string;
  subtitle: string;
  showAdvances: boolean;
  action?: React.ReactNode;
}) {
  const tabs = TABS.filter((t) => t.key !== "cash-advance" || showAdvances);
  return (
    <div className="space-y-5">
      <nav aria-label="Breadcrumb" className="text-sm text-ink-500">
        <span>Finance</span>
        <span className="mx-2">/</span>
        <Link href="/cash-expense/petty-cash" className="hover:text-ink-800">
          Cash Expense
        </Link>
        <span className="mx-2">/</span>
        <span className="text-ink-800">{title}</span>
      </nav>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-ink-900">{title}</h1>
          <p className="mt-1 text-sm text-ink-600">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <LiveUpdates />
          {action}
        </div>
      </div>
      <div className="flex flex-wrap gap-1 rounded-lg bg-ink-200/60 p-1 sm:inline-flex">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            aria-current={t.key === tab ? "page" : undefined}
            className={`rounded-md px-6 py-2.5 text-sm font-medium ${
              t.key === tab ? "bg-[#8a1a28] text-white shadow-sm" : "text-ink-600 hover:bg-ink-50 hover:text-ink-900"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

const ICON_TONES = {
  green: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  blue: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  violet: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
} as const;

/** One of the summary cards across the top of a Cash Expense page. */
export function CashStat({
  icon,
  tone,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  tone: keyof typeof ICON_TONES;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-ink-200 bg-ink-50 px-5 py-5">
      <span aria-hidden className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${ICON_TONES[tone]}`}>
        {icon}
      </span>
      <div className="min-w-0">
        <div className="text-sm text-ink-600">{label}</div>
        <div className="mt-0.5 text-2xl font-bold tabular-nums text-ink-900">{value}</div>
        {sub && <div className="mt-0.5 text-xs text-ink-500">{sub}</div>}
      </div>
    </div>
  );
}

/** Line icons for the stat cards (stroke follows the text colour). */
export const CashIcons = {
  cash: (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 9.5v5M18 9.5v5" />
    </svg>
  ),
  clock: (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  ),
  trend: (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M15 7h6v6" />
    </svg>
  ),
  people: (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor">
      <circle cx="9" cy="8" r="3.2" />
      <circle cx="16.5" cy="9" r="2.6" />
      <path d="M2.5 19c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6v1h-13v-1zM15.5 20v-1c0-1.7-.5-3.2-1.4-4.4.8-.4 1.6-.6 2.4-.6 2.9 0 5 1.9 5 4.8V20h-6z" />
    </svg>
  ),
  receipt: (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3z" />
      <path d="M9 8h6M9 12h6M9 16h3" />
    </svg>
  ),
};

const STATUS_TONES: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  APPROVED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  RELEASED: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  FOR_LIQUIDATION: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
  LIQUIDATED: "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300",
  ACTIVE: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  PAID: "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300",
  REJECTED: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  CANCELLED: "bg-ink-100 text-ink-600",
};

export function CashStatus({ status, label }: { status: string; label: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${STATUS_TONES[status] ?? "bg-ink-100 text-ink-600"}`}>
      {label}
    </span>
  );
}

/** Card frame used by the panels (Quick Record, activity tables). */
export function Panel({ title, action, children, className = "" }: { title: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-xl border border-ink-200 bg-ink-50 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
        <h2 className="text-lg font-semibold text-ink-900">{title}</h2>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}
