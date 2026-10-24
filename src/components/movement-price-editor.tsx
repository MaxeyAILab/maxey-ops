"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { parsePrice } from "@/lib/warehouse-value";

const money = (n: number) => `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Owner only, in the material movement log: set or change the price an issue was valued at — for one that was logged before the
 * item had a price. The value (quantity × price) is what the project is charged, so the project's cost follows. It offers the
 * item's current price, and can price the item's other unpriced movements in the same step.
 */
export function MovementPriceEditor({ id, itemName, current, itemPrice, otherUnpriced }: { id: string; itemName: string; current: number | null; itemPrice: number | null; otherUnpriced: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(current !== null ? String(current) : itemPrice !== null ? String(itemPrice) : "");
  const [also, setAlso] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const price = parsePrice(text);
    if (price === undefined || price === null) return setError("Type the price per unit, like 150 or 1,250.50");
    setBusy(true);
    setError("");
    const res = await fetch(`/api/inventory/movements/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "set_price", unitPrice: price, alsoOtherUnpriced: also && otherUnpriced > 0 }) });
    setBusy(false);
    if (!res.ok) return setError(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Couldn't save the price");
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="block text-[11px] font-medium text-brand-600 hover:underline" aria-label={`${current === null ? "Set" : "Change"} the price of this ${itemName} movement`}>
        {current === null ? "set price" : "change price"}
      </button>
    );
  }
  return (
    <form onSubmit={save} className="mt-1 w-52 space-y-1.5 rounded-lg border border-ink-200 bg-ink-50 p-2 text-left">
      <label className="block text-[11px] text-ink-600">
        Price per unit (₱)
        <input value={text} onChange={(e) => setText(e.target.value)} inputMode="decimal" autoFocus className="mt-0.5 min-h-[34px] w-full rounded-md border border-ink-200 bg-white px-2 text-right tabular-nums text-sm text-ink-900 focus:border-[#8a1a28] focus:outline-none dark:bg-transparent" />
      </label>
      {itemPrice !== null && itemPrice !== current && (
        <button type="button" onClick={() => setText(String(itemPrice))} className="text-[11px] text-brand-600 hover:underline">
          use the item&apos;s price now ({money(itemPrice)})
        </button>
      )}
      {otherUnpriced > 0 && (
        <label className="flex items-start gap-1.5 text-[11px] text-ink-700">
          <input type="checkbox" checked={also} onChange={(e) => setAlso(e.target.checked)} className="mt-0.5" />
          Also price the {otherUnpriced} other {otherUnpriced === 1 ? "movement" : "movements"} of this item that {otherUnpriced === 1 ? "has" : "have"} no price
        </label>
      )}
      {error && <p className="text-[11px] text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="rounded-md bg-[#8a1a28] px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-50">
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-[11px] text-ink-500 hover:underline">
          Cancel
        </button>
      </div>
    </form>
  );
}
