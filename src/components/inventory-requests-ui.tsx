"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const btn = "rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50";

async function call(url: string, method: "PATCH" | "DELETE", body?: unknown): Promise<string | null> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  if (res.ok) return null;
  return ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Something went wrong";
}

/**
 * Approve or reject one return/transfer request (office staff), or cancel it (the person who asked). Approving is what actually
 * moves the stock or the tool; until then nothing has changed.
 */
export function RequestDecision({ kind, id, canDecide, mine }: { kind: "stock" | "tool"; id: string; canDecide: boolean; mine: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const url = kind === "stock" ? `/api/inventory/movements/${id}` : `/api/tools/movements/${id}`;

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    const err = await call(url, "PATCH", body);
    setBusy(false);
    if (err) setError(err);
    else router.refresh();
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        {canDecide && (
          <>
            <button type="button" disabled={busy} onClick={() => act({ action: "approve" })} className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}>
              Approve
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                const reason = window.prompt("Why is this being rejected?");
                if (reason && reason.trim().length >= 3) act({ action: "reject", reason: reason.trim() });
              }}
              className={`${btn} border border-ink-200 text-ink-700 hover:bg-ink-100`}
            >
              Reject
            </button>
          </>
        )}
        {mine && (
          <button
            type="button"
            disabled={busy}
            onClick={() => window.confirm("Cancel your request?") && act({ action: "cancel" })}
            className={`${btn} border border-ink-200 text-ink-600 hover:bg-ink-100`}
          >
            Cancel my request
          </button>
        )}
        {!canDecide && !mine && <span className="text-xs text-ink-500">Waiting for office staff to approve</span>}
        {!canDecide && mine && <span className="text-xs text-ink-500">Waiting for office staff</span>}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

/** Owner only: remove a stock item (e.g. one entered while testing), with its logged movements and on-site records. */
export function DeleteStockItemButton({ id, name, movements, onSiteTotal, warehouseQty }: { id: string; name: string; movements: number; onSiteTotal: number; warehouseQty: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function remove() {
    const parts = [
      warehouseQty > 0 ? `${warehouseQty} in the warehouse` : null,
      onSiteTotal > 0 ? `${onSiteTotal} on project sites` : null,
      movements > 0 ? `${movements} logged movement${movements === 1 ? "" : "s"}` : null,
    ].filter(Boolean);
    const detail = parts.length > 0 ? `\n\nThis also removes: ${parts.join(", ")}.` : "";
    if (!window.confirm(`Delete “${name}” from the warehouse stock?${detail}\n\nThis can't be undone (the audit log keeps a record).`)) return;
    setBusy(true);
    setError("");
    const err = await call(`/api/inventory/items/${id}`, "DELETE");
    setBusy(false);
    if (err) setError(err);
    else router.refresh();
  }

  return (
    <span>
      <button type="button" onClick={remove} disabled={busy} aria-label={`Delete ${name}`} className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50">
        {busy ? "…" : "Delete"}
      </button>
      {error && <span className="ml-2 text-xs text-red-600">{error}</span>}
    </span>
  );
}
