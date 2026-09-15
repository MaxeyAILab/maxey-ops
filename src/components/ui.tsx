import * as React from "react";

/** Minimal shadcn-style primitives shared across the app. */

function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx("rounded-sm border border-ink-200 bg-ink-50", className)}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-ink-100 px-4 py-3 sm:px-5">
      <div>
        <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-ink-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function CardBody({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("px-4 py-4 sm:px-5", className)} {...props} />;
}

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost" | "success";

export function Button({
  variant = "primary",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  const styles: Record<ButtonVariant, string> = {
    primary: "bg-brand-500 text-white hover:bg-brand-600 focus-visible:ring-brand-500",
    secondary:
      "border border-ink-200 bg-ink-50 text-ink-700 hover:bg-ink-100 focus-visible:ring-ink-400",
    danger: "bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500",
    success: "bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:ring-emerald-500",
    ghost: "text-ink-600 hover:bg-ink-100 focus-visible:ring-ink-400",
  };
  return (
    <button
      className={cx(
        // min 44px tap target for field use (Spec §8 mobile-first)
        "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-sm px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
        styles[variant],
        className
      )}
      {...props}
    />
  );
}

export function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cx(
        "block min-h-[44px] w-full rounded-sm border border-ink-200 bg-ink-50 px-3 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500",
        className
      )}
      {...props}
    />
  );
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cx(
        "block w-full rounded-sm border border-ink-200 bg-ink-50 px-3 py-2.5 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500",
        className
      )}
      {...props}
    />
  );
}

export function Select({
  className,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cx(
        "block min-h-[44px] w-full rounded-sm border border-ink-200 bg-ink-50 px-3 text-sm text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500",
        className
      )}
      {...props}
    />
  );
}

export function Label({
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cx("mb-1.5 block text-xs font-medium text-ink-600", className)}
      {...props}
    />
  );
}

// Each pastel tone gets a dark: variant (translucent-on-dark background,
// lightened text) so status chips stay legible against a dark page — the
// ink-100/ink-600 tones already flip for free via CSS-variable colors.
const blue = "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300";
const amber = "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300";
const violet = "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300";
const cyan = "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300";
const teal = "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300";
const red = "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300";

const badgeTones: Record<string, string> = {
  // lead pipeline
  NEW: blue,
  UNDER_REVIEW: amber,
  ESTIMATE_IN_PROGRESS: violet,
  QUOTATION_SENT: cyan,
  WON: teal,
  LOST: red, // shared with tool/equipment "Lost" status
  // requisitions
  SUBMITTED: blue,
  APPROVED: teal,
  REJECTED: red,
  PO_ISSUED: cyan,
  DELIVERED: teal,
  // change orders / payments
  PENDING_CLIENT: amber,
  PENDING: "bg-ink-100 text-ink-600",
  DUE: amber,
  PAID: teal,
  // projects (construction lifecycle)
  SITE_SURVEY: violet,
  MOBILIZATION: blue,
  ONGOING_CONSTRUCTION: teal,
  NOT_ACTIVE: "bg-ink-100 text-ink-600",
  ON_HOLD: amber,
  FOR_PUNCHLIST: cyan,
  TURNED_OVER: blue,
  CANCELLED: "bg-ink-100 text-ink-600", // PO status
  // urgency
  LOW: "bg-ink-100 text-ink-600",
  NORMAL: blue,
  HIGH: amber,
  CRITICAL: red,
  // PO
  OPEN: blue,
  PARTIALLY_DELIVERED: amber,
  // quotation
  DRAFT: "bg-ink-100 text-ink-600",
  SENT: cyan,
  ACCEPTED: teal,
  // tool/equipment status
  IN_WAREHOUSE: "bg-ink-100 text-ink-600",
  ON_SITE: teal,
  UNDER_REPAIR: amber,
  // site instructions / assignments
  NOT_STARTED: "bg-ink-100 text-ink-600",
  IN_PROGRESS: blue,
  FOR_REVIEW: violet,
  COMPLETED: teal,
  NEEDS_REVISION: red,
};

export function Badge({ value, label }: { value: string; label?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-sm px-2.5 py-0.5 text-xs font-medium",
        badgeTones[value] ?? "bg-ink-100 text-ink-600"
      )}
    >
      {label ??
        value
          .toLowerCase()
          .split("_")
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" ")}
    </span>
  );
}

export function Table({
  className,
  ...props
}: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto">
      <table className={cx("w-full text-left text-sm", className)} {...props} />
    </div>
  );
}

export function Th({
  className,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cx(
        "border-b border-ink-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-ink-500",
        className
      )}
      {...props}
    />
  );
}

export function Td({
  className,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cx("border-b border-ink-50 px-3 py-2.5 align-top text-ink-800", className)}
      {...props}
    />
  );
}

export function Stat({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "default" | "good" | "bad" | "brand" | "warning";
}) {
  const tones = {
    default: "text-ink-900",
    good: "text-teal-600",
    bad: "text-red-600",
    brand: "text-brand-600",
    warning: "text-orange-600",
  };
  return (
    <Card className="px-4 py-3.5 sm:px-5">
      <div className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</div>
      <div className={cx("mt-1 text-2xl font-bold tabular-nums", tones[tone])}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-ink-500">{sub}</div>}
    </Card>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-sm border border-dashed border-ink-200 px-6 py-10 text-center text-sm text-ink-500">
      {children}
    </div>
  );
}
