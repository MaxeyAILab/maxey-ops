/**
 * Project history export helpers. The export is built from the audit trail, so the main
 * risk is leaking money: amounts sit inside the audit "diff" JSON under many key names.
 * Redaction therefore works by key name and removes anything that looks financial.
 */

const MONEY_KEY = /cost|amount|price|contract|margin|net|gross|salary|rate|estimate|total|retention|payment/i;

/** Removes financial values (by key name) from a diff, at any depth. Returns a new object; the input is untouched. */
export function redactDiff(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactDiff);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (MONEY_KEY.test(k)) continue;
      out[k] = redactDiff(v);
    }
    return out;
  }
  return value;
}

/** One short text summary of a diff for a CSV cell. */
export function summarizeDiff(diff: unknown, allowMoney: boolean): string {
  const clean = allowMoney ? diff : redactDiff(diff);
  if (clean == null) return "";
  const flat: string[] = [];
  const walk = (v: unknown, prefix: string) => {
    if (v == null) return;
    if (Array.isArray(v)) {
      flat.push(`${prefix}=${v.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join("|")}`);
    } else if (typeof v === "object") {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, prefix ? `${prefix}.${k}` : k);
    } else {
      flat.push(`${prefix}=${String(v)}`);
    }
  };
  walk(clean, "");
  return flat.join("; ").slice(0, 600);
}

/**
 * CSV cell escaping, including spreadsheet formula injection: a cell that starts with
 * = + - @ (or a tab/CR) is prefixed with an apostrophe so Excel/Sheets show it as text
 * instead of running it.
 */
export function csvCell(raw: unknown): string {
  let s = raw == null ? "" : String(raw);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
