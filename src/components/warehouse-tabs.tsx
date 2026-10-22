import Link from "next/link";
import { WAREHOUSES, warehouseSlug, type WarehouseValue } from "@/lib/warehouses";

/**
 * The tabs that switch between the four warehouses. Plain links: the chosen warehouse is in the page address (?wh=alua), so a
 * tab can be bookmarked, shared, and survives a refresh. Other things in the address (the tools filter, the search words) are
 * kept; the page does not jump back to the top when a tab is clicked.
 */
export function WarehouseTabs({
  current,
  counts,
  path,
  params = {},
  noun = "items",
  label = "Warehouse",
}: {
  current: WarehouseValue;
  /** how many items (or tools) each warehouse has — shown on its tab */
  counts: Record<WarehouseValue, number>;
  /** the page the tabs lead to, e.g. "/inventory" */
  path: string;
  /** the rest of the page address to keep while switching */
  params?: Record<string, string | undefined>;
  noun?: string;
  label?: string;
}) {
  return (
    <nav aria-label={label} className="flex flex-wrap items-center gap-1.5">
      {WAREHOUSES.map((w) => {
        const on = w.value === current;
        const qs = new URLSearchParams();
        for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
        if (w.value !== "MAIN") qs.set("wh", warehouseSlug(w.value));
        return (
          <Link
            key={w.value}
            href={`${path}${qs.toString() ? `?${qs}` : ""}`}
            scroll={false}
            aria-current={on ? "page" : undefined}
            title={`${w.label} — ${counts[w.value]} ${noun}`}
            className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition ${on ? "border-[#8a1a28] bg-[#8a1a28] text-white" : "border-ink-200 text-ink-700 hover:bg-ink-100"}`}
          >
            {w.short}
            <span className={`rounded-full px-1.5 text-xs tabular-nums ${on ? "bg-white/20 text-white" : "bg-ink-100 text-ink-500"}`}>{counts[w.value]}</span>
          </Link>
        );
      })}
    </nav>
  );
}
