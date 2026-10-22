"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { lineValue, parsePrice } from "@/lib/warehouse-value";
import { toast } from "@/components/feedback-provider";

export interface PriceRow {
  id: string;
  name: string;
  unit: string;
  qty: number;
  price: number | null;
}

const peso = (n: number) => `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * A table to type the price per unit of many items in one go, with each line's total and the running total as you type. Only the
 * prices you changed are saved, together.
 */
export function PriceEditor({ rows, doneHref }: { rows: PriceRow[]; doneHref: string }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(rows.map((r) => [r.id, r.price == null ? "" : String(r.price)])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const parsed = rows.map((r) => ({ row: r, price: parsePrice(values[r.id] ?? "") }));
  const invalid = parsed.filter((p) => p.price === undefined);
  const changed = parsed.filter((p) => p.price !== undefined && p.price !== p.row.price);
  const total = parsed.reduce((sum, p) => sum + (p.price == null ? 0 : (lineValue(p.row.qty, p.price) ?? 0)), 0);
  const missing = parsed.filter((p) => p.price == null).length;

  async function save() {
    if (invalid.length > 0) return setError(`“${invalid[0].row.name}” has a price that is not an amount — use a number like 150 or 1,250.50.`);
    setBusy(true);
    setError("");
    const res = await fetch("/api/inventory/prices", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prices: changed.map((c) => ({ id: c.row.id, unitPrice: c.price ?? null })) }),
    });
    setBusy(false);
    if (!res.ok) return setError(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Couldn't save the prices");
    toast(`${changed.length} price${changed.length === 1 ? "" : "s"} saved`);
    router.push(doneHref);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-lg border border-ink-200 bg-ink-50">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="bg-ink-100 text-ink-700">
            <tr>
              <th className="sticky left-0 z-[1] bg-ink-100 px-3 py-2.5 font-semibold shadow-[1px_0_0_rgb(var(--ink-200))]">Item</th>
              <th className="px-3 py-2.5 text-right font-semibold">Qty</th>
              <th className="px-3 py-2.5 font-semibold">Unit</th>
              <th className="w-40 px-3 py-2.5 text-right font-semibold">Price per unit (₱)</th>
              <th className="px-3 py-2.5 text-right font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {parsed.map(({ row, price }) => (
              <tr key={row.id} className="border-t border-ink-100">
                <td className="sticky left-0 z-[1] min-w-[7rem] max-w-[10rem] bg-ink-50 px-3 py-1.5 font-medium text-ink-900 shadow-[1px_0_0_rgb(var(--ink-200))] sm:max-w-none">{row.name}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{row.qty}</td>
                <td className="px-3 py-1.5">{row.unit}</td>
                <td className="px-3 py-1.5">
                  <input
                    inputMode="decimal"
                    aria-label={`Price per unit for ${row.name}`}
                    value={values[row.id] ?? ""}
                    onChange={(e) => setValues((v) => ({ ...v, [row.id]: e.target.value }))}
                    placeholder="0.00"
                    className={`block min-h-[36px] w-full rounded-md border bg-ink-50 px-2 text-right tabular-nums text-ink-900 focus:outline-none focus:ring-1 ${price === undefined ? "border-red-400 focus:ring-red-400" : "border-ink-200 focus:border-[#8a1a28] focus:ring-[#8a1a28]"}`}
                  />
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-ink-700">{price == null || price === undefined ? "—" : peso(lineValue(row.qty, price) ?? 0)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-ink-400">
                  No items here.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-ink-100 px-4 py-3 text-sm">
        <span>
          Total of these items: <b className="tabular-nums">{peso(total)}</b>
          {missing > 0 && <span className="text-ink-500"> · {missing} without a price</span>}
        </span>
        <span className="text-ink-500">{changed.length} changed</span>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <Button onClick={save} disabled={busy || changed.length === 0 || invalid.length > 0}>
          {busy ? "Saving…" : changed.length === 0 ? "Save prices" : `Save ${changed.length} price${changed.length === 1 ? "" : "s"}`}
        </Button>
        <Link href={doneHref} className="inline-flex min-h-[44px] items-center rounded-lg border border-ink-200 px-4 text-sm font-medium text-ink-700 hover:bg-ink-100">
          Cancel
        </Link>
      </div>
    </div>
  );
}
