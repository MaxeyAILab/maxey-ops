"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const SHORT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const day = (key: string) => SHORT.format(new Date(`${key}T00:00:00Z`));

/**
 * The target-date box on a task: shows how late it is, lets the people doing it ask for more time (new date + reason), and lets
 * the Owner/PM approve or reject a waiting request. Every rule is checked again on the server.
 */
export function InstructionExtension({
  instructionId,
  dueKey,
  todayKey,
  state,
  canAsk,
  canDecide,
  pending,
  extensionCount,
  originalDueKey,
}: {
  instructionId: string;
  dueKey: string | null;
  todayKey: string;
  /** "overdue" / "today" when the task is due and not done yet */
  state: "overdue" | "today" | null;
  canAsk: boolean;
  canDecide: boolean;
  pending: { dueKey: string; reason: string; byName: string; mine: boolean } | null;
  extensionCount: number;
  originalDueKey: string | null;
}) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/instructions/${instructionId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (!res.ok) {
      setError(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Couldn't save it");
      return;
    }
    setAsking(false);
    setNote("");
    router.refresh();
  }

  if (!dueKey) return null;
  const lateDays = Math.round((Date.parse(`${todayKey}T00:00:00Z`) - Date.parse(`${dueKey}T00:00:00Z`)) / 86_400_000);
  const history = extensionCount > 0 && originalDueKey ? `Extended ${extensionCount}× · first target ${day(originalDueKey)}` : null;
  const nextDay = (() => {
    const base = dueKey > todayKey ? dueKey : todayKey;
    const d = new Date(`${base}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  })();

  return (
    <div className="space-y-2">
      {(state || history) && (
        <div className={`rounded-lg px-3 py-2 text-xs ${state === "overdue" ? "bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300" : state === "today" ? "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" : "bg-ink-100 text-ink-600"}`}>
          {state === "overdue" && (
            <b>
              ⚠ Overdue {lateDays} day{lateDays === 1 ? "" : "s"} — target was {day(dueKey)}.{" "}
            </b>
          )}
          {state === "today" && <b>Due today. </b>}
          {state && !pending && (canAsk ? "Update the status, or ask for an extension if you really need more time." : "A reminder goes to the people doing it every morning until it is updated.")}
          {history && <span className={state ? "ml-1 opacity-80" : ""}>{history}</span>}
        </div>
      )}

      {pending && (
        <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <div>
            <b>⏳ Extension asked</b> by {pending.byName}: move the target from {day(dueKey)} to <b>{day(pending.dueKey)}</b>
          </div>
          <div className="italic">“{pending.reason}”</div>
          {canDecide ? (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note to them (optional)" maxLength={1000} className="min-h-[34px] min-w-[180px] flex-1 rounded-lg border border-amber-300 bg-white px-2 text-xs text-ink-900 dark:bg-ink-50" />
              <button type="button" disabled={busy} onClick={() => send({ action: "decide_extension", decision: "approve", note })} className="min-h-[34px] rounded-lg bg-emerald-600 px-3 font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">
                Approve new date
              </button>
              <button type="button" disabled={busy} onClick={() => send({ action: "decide_extension", decision: "reject", note })} className="min-h-[34px] rounded-lg border border-red-300 bg-white px-3 font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60 dark:bg-ink-50">
                Reject
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <span>Waiting for the Owner/PM. Reminders are paused until they decide.</span>
              {pending.mine && (
                <button type="button" disabled={busy} onClick={() => send({ action: "cancel_extension" })} className="font-semibold underline disabled:opacity-60">
                  Withdraw request
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {!pending && canAsk && !asking && (
        <button type="button" onClick={() => setAsking(true)} className="text-xs font-semibold text-brand-600 hover:underline">
          ⏳ Request extension
        </button>
      )}

      {!pending && canAsk && asking && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            send({ action: "request_extension", dueDate: fd.get("dueDate"), reason: fd.get("reason") });
          }}
          className="space-y-2 rounded-lg border border-ink-200 bg-ink-100/50 p-3"
        >
          <div className="text-xs font-semibold text-ink-800">Request extension — only when it truly can't be done by {day(dueKey)}</div>
          <label className="block text-[11px] text-ink-600">
            New target date
            <input type="date" name="dueDate" required min={nextDay} defaultValue={nextDay} className="mt-1 block min-h-[38px] rounded-lg border border-ink-200 bg-ink-50 px-2 text-sm text-ink-900" />
          </label>
          <label className="block text-[11px] text-ink-600">
            Why is more time needed?
            <textarea name="reason" required minLength={10} maxLength={1000} rows={2} placeholder="e.g. Supplier moved the delivery to Thursday; can't pour without the rebar" className="mt-1 block w-full rounded-lg border border-ink-200 bg-ink-50 px-2 py-1.5 text-sm text-ink-900" />
          </label>
          <div className="flex items-center gap-3">
            <button type="submit" disabled={busy} className="fx-grad min-h-[36px] rounded-full bg-accent px-4 text-xs font-semibold text-white disabled:opacity-60">
              {busy ? "Sending…" : "Send to Owner/PM"}
            </button>
            <button type="button" onClick={() => setAsking(false)} className="text-xs text-ink-500 hover:text-ink-700">
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && <p className="text-xs font-medium text-red-600">{error}</p>}
    </div>
  );
}
