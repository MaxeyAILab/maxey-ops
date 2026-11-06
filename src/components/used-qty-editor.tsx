"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Owner only, in the material movement log, on a "Used on site" row: correct the quantity that was logged. It only corrects the
 * record — the site's stock is left as it is — unless the box is ticked, which makes the site balance follow the difference.
 */
export function UsedQtyEditor({ id, itemName, unit, current, project }: { id: string; itemName: string; unit: string; current: number; project: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(String(current));
  const [reason, setReason] = useState("");
  const [adjust, setAdjust] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const next = Number(text.replace(/,/g, ""));
  const valid = text.trim() !== "" && Number.isFinite(next) && next > 0;
  const diff = valid ? Math.round((current - next) * 100) / 100 : 0;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return setError("Type how many were really used, like 11 or 2.5");
    if (reason.trim().length < 3) return setError("Say why it is being corrected");
    setBusy(true);
    setError("");
    const res = await fetch(`/api/inventory/movements/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "edit_used_qty", qty: next, reason: reason.trim(), adjustSiteStock: adjust }) });
    setBusy(false);
    if (!res.ok) return setError(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Couldn't save the correction");
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="block text-[11px] font-medium text-brand-600 hover:underline ml-auto" aria-label={`Correct the quantity used of ${itemName}`}>
        edit qty
      </button>
    );
  }
  return (
    <form onSubmit={save} className="mt-1 w-56 space-y-1.5 rounded-lg border border-ink-200 bg-ink-50 p-2 text-left text-ink-900">
      <label className="block text-[11px] text-ink-600">
        Really used ({unit})
        <input value={text} onChange={(e) => setText(e.target.value)} inputMode="decimal" autoFocus className="mt-0.5 min-h-[34px] w-full rounded-md border border-ink-200 bg-white px-2 text-right tabular-nums text-sm text-ink-900 focus:border-[#8a1a28] focus:outline-none dark:bg-transparent" />
      </label>
      <label className="block text-[11px] text-ink-600">
        Why
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="e.g. typed 22, only 11 used" className="mt-0.5 min-h-[34px] w-full rounded-md border border-ink-200 bg-white px-2 text-sm text-ink-900 focus:border-[#8a1a28] focus:outline-none dark:bg-transparent" />
      </label>
      <label className="flex items-start gap-1.5 text-[11px] text-ink-700">
        <input type="checkbox" checked={adjust} onChange={(e) => setAdjust(e.target.checked)} className="mt-0.5" />
        Also change the stock on site at {project}
      </label>
      <p className="text-[11px] text-ink-500">
        {!valid || diff === 0
          ? "The on-site stock is not touched."
          : !adjust
            ? `Only the log changes. The on-site stock stays as it is (no ${Math.abs(diff)} ${unit} ${diff > 0 ? "put back" : "taken out"}).`
            : diff > 0
              ? `${diff} ${unit} will be put back on the site's stock.`
              : `${Math.abs(diff)} ${unit} more will be taken from the site's stock.`}
      </p>
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
