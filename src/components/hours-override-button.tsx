"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";

/** Owner-only inline correction for one employee's "Hours Today" — opens a
 * number field + an "approve over 8 hours" checkbox right next to the
 * displayed value. Setting it is itself the approval; the box must be
 * checked to save anything over 8, so a typo can't silently blow past the
 * standard cap. */
export function EditTodayHoursButton({
  userId,
  currentHours,
}: {
  userId: string;
  currentHours: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [hours, setHours] = useState(currentHours.toFixed(1));
  const [approvedOver8, setApprovedOver8] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onSave() {
    setBusy(true);
    setError("");
    const todayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
    const res = await fetch("/api/attendance/hours-override", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, date: todayKey, hours: Number(hours), approvedOver8 }),
    });
    setBusy(false);
    if (res.ok) {
      setOpen(false);
      router.refresh();
    } else {
      setError((await res.json()).error ?? "Failed to save");
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="ml-1.5 text-[10px] font-medium text-brand-600 hover:underline"
        aria-label="Edit today's hours"
      >
        edit
      </button>
    );
  }

  return (
    <div className="absolute right-0 z-10 mt-1 w-56 space-y-2 rounded-lg border border-brand-200 bg-white p-3 text-left shadow-lg dark:bg-ink-900">
      <label className="block text-xs font-medium text-ink-600">
        Hours today
        <input
          type="number"
          min="0"
          max="24"
          step="0.1"
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          className="mt-1 block w-full rounded border border-ink-200 bg-ink-50 px-2 py-1 text-sm tabular-nums"
        />
      </label>
      {Number(hours) > 8 && (
        <label className="flex items-center gap-1.5 text-xs text-amber-700">
          <input
            type="checkbox"
            checked={approvedOver8}
            onChange={(e) => setApprovedOver8(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-ink-300"
          />
          Approve over 8 hours
        </label>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => setOpen(false)} className="text-xs">
          Cancel
        </Button>
        <Button type="button" disabled={busy} onClick={onSave} className="text-xs">
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

/** Owner-only inline correction for an employee's running TOTAL for the
 * current pay period. Saves the difference from the computed total as an
 * adjustment, so hours logged afterwards keep adding on top. */
export function EditPeriodTotalButton({
  userId,
  projectId,
  currentTotal,
  periodLabel,
}: {
  userId: string;
  projectId: string | null;
  currentTotal: number;
  periodLabel: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [total, setTotal] = useState(currentTotal.toFixed(1));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onSave() {
    setBusy(true);
    setError("");
    const res = await fetch("/api/attendance/period-total", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, projectId, total: Number(total) }),
    });
    setBusy(false);
    if (res.ok) {
      setOpen(false);
      router.refresh();
    } else {
      setError((await res.json()).error ?? "Failed to save");
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setTotal(currentTotal.toFixed(1));
          setOpen(true);
        }}
        className="ml-1.5 text-[10px] font-medium text-brand-600 hover:underline"
        aria-label="Edit total hours for this pay period"
      >
        edit
      </button>
    );
  }

  return (
    <div className="absolute right-0 z-10 mt-1 w-60 space-y-2 rounded-lg border border-brand-200 bg-white p-3 text-left shadow-lg dark:bg-ink-900">
      <label className="block text-xs font-medium text-ink-600">
        Total hours — {periodLabel}
        <input
          type="number"
          min="0"
          max="500"
          step="0.1"
          value={total}
          onChange={(e) => setTotal(e.target.value)}
          className="mt-1 block w-full rounded border border-ink-200 bg-ink-50 px-2 py-1 text-sm tabular-nums"
        />
      </label>
      <p className="text-[11px] text-ink-500">
        Hours logged after this keep adding on top. Payroll for this period uses the corrected total.
      </p>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => setOpen(false)} className="text-xs">
          Cancel
        </Button>
        <Button type="button" disabled={busy} onClick={onSave} className="text-xs">
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
