"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Owner: close a shift the person forgot to time out of. The time defaults to 5:00 PM of the day the shift started (or the current
 * time when that is still today and earlier) — the end of the day, for someone who did no overtime. Shown next to "On duty since".
 */
export function ForceTimeOutButton({ attendanceId, name, since, defaultTime }: { attendanceId: string; name: string; since: string; defaultTime: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [time, setTime] = useState(defaultTime);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  async function go() {
    if (!window.confirm(`Time ${name} out at ${time}? Their shift that began ${since} will end then.`)) return;
    setBusy(true);
    setError("");
    const res = await fetch("/api/attendance/force-timeout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ attendanceId, time }) });
    setBusy(false);
    const data = (await res.json().catch(() => null)) as { error?: string; payrollAlreadyApproved?: boolean } | null;
    if (!res.ok) return setError(data?.error ?? "Could not time them out");
    if (data?.payrollAlreadyApproved) setNote("Closed. Payroll for that period was already approved, so these hours are not in it.");
    else setOpen(false);
    router.refresh();
  }

  if (note) return <span className="block text-[11px] text-amber-700">{note}</span>;
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="ml-2 text-[11px] font-medium text-red-600 hover:underline" title="They forgot to time out">
        Time out
      </button>
    );
  }
  return (
    <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-600">
      <label htmlFor={`fto-${attendanceId}`}>Out at</label>
      <input id={`fto-${attendanceId}`} type="time" value={time} onChange={(e) => setTime(e.target.value)} className="rounded border border-ink-200 bg-white px-1.5 py-0.5 text-xs dark:bg-transparent" />
      <button type="button" disabled={busy || !time} onClick={go} className="rounded bg-red-600 px-2 py-0.5 text-xs font-medium text-white disabled:opacity-50">
        {busy ? "…" : "Time out"}
      </button>
      <button type="button" disabled={busy} onClick={() => setOpen(false)} className="text-ink-500 hover:underline">
        Cancel
      </button>
      <span className="basis-full text-ink-400">For someone who forgot — no overtime. Hours after 5:00 PM only count if overtime is approved.</span>
      {error && <span className="basis-full text-red-600">{error}</span>}
    </span>
  );
}
