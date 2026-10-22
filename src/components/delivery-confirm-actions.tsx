"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const btn = "min-h-[44px] rounded-lg px-4 text-sm font-semibold disabled:opacity-50";

/**
 * The second step of verifying a delivery: the person who received it confirms they did — or reports a problem instead, which
 * tells the office and leaves it unconfirmed. The Owner can confirm for anyone (the button then says on whose behalf).
 */
export function ConfirmDeliveryButtons({ id, poNumber, onBehalfOf }: { id: string; poNumber: string; onBehalfOf: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reporting, setReporting] = useState(false);
  const [note, setNote] = useState("");

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/deliveries/${id}/confirm`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (!res.ok) return setError(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Something went wrong");
    setReporting(false);
    setNote("");
    router.refresh();
  }

  function confirm() {
    const who = onBehalfOf ? `Confirm for ${onBehalfOf} that ${poNumber} was received?` : `Confirm that you received ${poNumber} — the items and quantities listed?`;
    if (window.confirm(who)) send({ action: "confirm" });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy} onClick={confirm} className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}>
          {busy ? "Saving…" : onBehalfOf ? `✓ Confirm for ${onBehalfOf}` : "✓ I received this delivery"}
        </button>
        {!reporting && (
          <button type="button" disabled={busy} onClick={() => setReporting(true)} className={`${btn} border border-ink-200 text-ink-700 hover:bg-ink-100`}>
            Report a problem
          </button>
        )}
      </div>
      {reporting && (
        <div className="space-y-2 rounded-lg border border-dashed border-ink-200 p-3">
          <label className="block text-xs font-medium text-ink-600">
            What is wrong? (the office and the driver are told; the delivery stays unconfirmed)
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g., only 2 bags came, not 5" className="mt-1 min-h-[40px] w-full rounded-lg border border-ink-200 bg-ink-50 px-3 text-sm text-ink-900 focus:border-[#8a1a28] focus:outline-none" />
          </label>
          <div className="flex gap-2">
            <button type="button" disabled={busy || note.trim().length < 5} onClick={() => send({ action: "dispute", note: note.trim() })} className={`${btn} bg-[#8a1a28] text-white hover:bg-[#741522]`}>
              Send report
            </button>
            <button type="button" onClick={() => setReporting(false)} className={`${btn} border border-ink-200 text-ink-700 hover:bg-ink-100`}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
