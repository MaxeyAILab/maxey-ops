const TZ = "Asia/Manila";

const phpFmt = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});

const phpCompactFmt = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  notation: "compact",
  maximumFractionDigits: 1,
});

/** Accepts numbers, strings, and Prisma Decimal (anything with toString). */
type Amount = number | string | { toString(): string } | null | undefined;

export function php(amount: Amount): string {
  const n = amount == null ? 0 : Number(amount.toString());
  return phpFmt.format(Number.isFinite(n) ? n : 0);
}

export function phpCompact(amount: Amount): string {
  const n = amount == null ? 0 : Number(amount.toString());
  return phpCompactFmt.format(Number.isFinite(n) ? n : 0);
}

export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: TZ,
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(d));
}

export function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: TZ,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(d));
}

export function daysSince(d: Date | string): number {
  return Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000);
}

/** Human label from an enum-style value: UNDER_REVIEW → "Under Review" */
export function labelize(v: string): string {
  return v
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
