"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label } from "@/components/ui";

export interface SubItemsManagerItem {
  workItem: string;
  weight: number;
  pctComplete: number;
  color: string;
  subs: { name: string; weight: number; pctComplete: number }[];
}

interface Row {
  key: number;
  name: string;
  weight: string;
  pct: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * For the PM and Owner: break a work item into sub-items (or change them). Each sub-item gets its own weight — its share of the
 * WHOLE project — and the weights must add up to the work item's weight (e.g. Earthfilling and Compaction 40% → earthfill materials
 * 15, spreading 10, compaction 15). Afterwards each sub-item is reported like any other progress entry and the work item's
 * completion is the weighted average of its parts.
 */
export function SubItemsManager({ projectId, items, bare = false }: { projectId: string; items: SubItemsManagerItem[]; bare?: boolean }) {
  if (items.length === 0) return null;
  return (
    <div className={bare ? "space-y-2" : "space-y-2 rounded-lg border border-ink-100 p-3"}>
      {!bare && (
        <>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Sub-items of a work item</p>
          <p className="text-xs text-ink-500">Break a work item into its parts so the client sees more detail. The parts&apos; weights must add up to the item&apos;s weight.</p>
        </>
      )}
      <ul className="divide-y divide-ink-100">
        {items.map((it) => (
          // the key includes the sub-items, so the editor starts again from the saved figures after a save
          <SubItemsRow key={`${it.workItem}|${JSON.stringify(it.subs)}`} projectId={projectId} item={it} />
        ))}
      </ul>
    </div>
  );
}

function SubItemsRow({ projectId, item }: { projectId: string; item: SubItemsManagerItem }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [nextKey, setNextKey] = useState(10);
  const [rows, setRows] = useState<Row[]>(() =>
    item.subs.length > 0
      ? item.subs.map((s, i) => ({ key: i, name: s.name, weight: String(round2(s.weight)), pct: String(round2(s.pctComplete)) }))
      : [
          { key: 0, name: "", weight: "", pct: "" },
          { key: 1, name: "", weight: "", pct: "" },
        ]
  );

  const total = round2(rows.reduce((s, r) => s + (Number(r.weight) || 0), 0));
  const left = round2(item.weight - total);
  const setRow = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  async function save(items: { name: string; weight: number; pctComplete?: number }[]) {
    setBusy(true);
    setError("");
    const res = await fetch("/api/progress/breakdown", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, workItem: item.workItem, weight: item.weight, color: item.color, items }),
    });
    setBusy(false);
    if (!res.ok) return setError(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Could not save the sub-items");
    setOpen(false);
    router.refresh();
  }

  return (
    <li className="py-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-ink-800">
          <span className="font-medium">{item.workItem}</span> <span className="text-xs text-ink-400">({round2(item.weight)}% of the project)</span>
          {item.subs.length > 0 && <span className="ml-2 text-xs text-emerald-700">{item.subs.length} sub-items</span>}
        </span>
        <button type="button" onClick={() => setOpen((o) => !o)} className="text-xs font-medium text-brand-600 hover:underline">
          {open ? "Close" : item.subs.length > 0 ? "Edit sub-items" : "Set sub-items"}
        </button>
      </div>

      {open && (
        <div className="mt-2 space-y-3 rounded-lg border border-brand-100 bg-brand-50/40 p-3">
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={r.key} className="space-y-2 rounded-lg border border-ink-100 bg-white p-2.5 dark:bg-transparent">
                <div>
                  <Label>{`Sub-item ${i + 1}`}</Label>
                  <Input value={r.name} onChange={(e) => setRow(r.key, { name: e.target.value })} placeholder="e.g. Spreading of earthfill" maxLength={200} aria-label={`Sub-item ${i + 1} name`} />
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="w-28">
                    <Label>Weight %</Label>
                    <Input type="number" min="0" step="0.01" inputMode="decimal" value={r.weight} onChange={(e) => setRow(r.key, { weight: e.target.value })} aria-label={`Sub-item ${i + 1} weight`} />
                  </div>
                  <div className="w-28">
                    <Label>Done %</Label>
                    <Input type="number" min="0" max="100" step="0.1" inputMode="decimal" value={r.pct} onChange={(e) => setRow(r.key, { pct: e.target.value })} placeholder={item.subs.length ? "" : String(round2(item.pctComplete))} aria-label={`Sub-item ${i + 1} completion`} />
                  </div>
                  <button type="button" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} className="pb-2 text-xs text-red-600 hover:underline">
                    Remove
                  </button>
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={() => {
                setRows((rs) => [...rs, { key: nextKey, name: "", weight: "", pct: "" }]);
                setNextKey((k) => k + 1);
              }}
              className="text-xs font-medium text-brand-600 hover:underline"
            >
              + Add a sub-item
            </button>
          </div>

          <p className={`text-xs font-medium ${Math.abs(left) < 0.005 ? "text-emerald-700" : "text-amber-700"}`}>
            {Math.abs(left) < 0.005
              ? `The sub-items add up to ${total}% — exactly ${item.workItem}.`
              : left > 0
                ? `${total}% allocated — ${left}% still to give to a sub-item (they must add up to ${round2(item.weight)}%).`
                : `${total}% allocated — ${round2(-left)}% too much (they must add up to ${round2(item.weight)}%).`}
          </p>
          <p className="text-[11px] text-ink-500">
            &quot;Done %&quot; is where each part stands now{item.subs.length === 0 ? ` — left empty, each starts at the item's current ${round2(item.pctComplete)}%` : ""}. Afterwards you report each part like any other progress update.
          </p>

          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {item.subs.length > 0 && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Take away the sub-items of ${item.workItem}? It goes back to being reported as one item, starting at ${round2(item.pctComplete)}% done.`)) save([]);
                }}
                className="mr-auto text-xs text-red-600 hover:underline"
              >
                Take the sub-items away
              </button>
            )}
            <Button type="button" variant="secondary" className="text-xs" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              className="text-xs"
              disabled={busy || rows.length < 2 || Math.abs(left) >= 0.005}
              onClick={() =>
                save(
                  rows.map((r) => ({
                    name: r.name.trim(),
                    weight: Number(r.weight),
                    ...(r.pct.trim() !== "" ? { pctComplete: Number(r.pct) } : {}),
                  }))
                )
              }
            >
              {busy ? "Saving…" : "Save sub-items"}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
