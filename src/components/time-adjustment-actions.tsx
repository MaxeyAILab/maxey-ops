"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Input, Label, Textarea } from "@/components/ui";

/** Small inline "Request early start credit" / "Request overtime credit"
 * button — opens a reason field, then posts the request. Once submitted (or
 * if one already exists), shows its status badge instead. */
export function RequestTimeAdjustmentButton({
  attendanceId,
  type,
  label,
  existingStatus,
}: {
  attendanceId: string;
  type: "EARLY_START" | "OVERTIME";
  label: string;
  existingStatus?: "PENDING" | "APPROVED" | "REJECTED";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);

  if (existingStatus || submitted) {
    return <Badge value={submitted && !existingStatus ? "PENDING" : existingStatus!} />;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/time-adjustments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attendanceId, type, reason }),
    });
    setBusy(false);
    if (res.ok) {
      setSubmitted(true);
      setOpen(false);
      router.refresh();
    } else {
      setError((await res.json()).error ?? "Failed to submit request");
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-medium text-brand-600 hover:underline"
      >
        {label}
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2 rounded-lg border border-brand-100 bg-brand-50/40 p-2">
      <Textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        required
        rows={2}
        placeholder="Reason — e.g., early delivery, morning concreting…"
        className="text-xs"
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => setOpen(false)} className="text-xs">
          Cancel
        </Button>
        <Button type="submit" disabled={busy} className="text-xs">
          {busy ? "Sending…" : "Send request"}
        </Button>
      </div>
    </form>
  );
}

/** For Office/Driver accounts, normally locked out of Sunday clock-in and
 * force-closed at 5pm Saturday: request permission to work a specific
 * upcoming Saturday or Sunday. Not tied to an existing attendance row — the
 * shift doesn't exist yet. */
export function RequestWeekendWorkButton({ existingStatus }: { existingStatus?: "PENDING" | "APPROVED" | "REJECTED" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);

  if (existingStatus || submitted) {
    return <Badge value={submitted && !existingStatus ? "PENDING" : existingStatus!} />;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/time-adjustments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "WEEKEND_WORK", date, reason }),
    });
    setBusy(false);
    if (res.ok) {
      setSubmitted(true);
      setOpen(false);
      router.refresh();
    } else {
      setError((await res.json()).error ?? "Failed to submit request");
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-medium text-brand-600 hover:underline"
      >
        Request weekend-work approval
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2 rounded-lg border border-brand-100 bg-brand-50/40 p-2">
      <div>
        <Label className="text-xs">Saturday or Sunday</Label>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required className="text-xs" />
      </div>
      <Textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        required
        rows={2}
        placeholder="Reason — e.g., month-end closing, urgent errand…"
        className="text-xs"
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => setOpen(false)} className="text-xs">
          Cancel
        </Button>
        <Button type="submit" disabled={busy} className="text-xs">
          {busy ? "Sending…" : "Send request"}
        </Button>
      </div>
    </form>
  );
}

export interface PendingTimeAdjustment {
  id: string;
  employeeName: string;
  type: "EARLY_START" | "OVERTIME" | "WEEKEND_WORK";
  reason: string;
  shiftLabel: string; // e.g. "Sep 17, 2026, 6:45 AM" or, for weekend-work, the requested date
  requestedByName: string;
  /** where the shift was clocked in / out ("lat,lng"), when the phone shared it */
  gpsIn?: string | null;
  gpsOut?: string | null;
  /** early start / overtime: how many hours were clocked beyond the schedule (what is being claimed) */
  claimedHours?: number | null;
  /** e.g. "In 7:55 AM → out 8:04 PM" */
  clockLabel?: string | null;
}

/** Owner/PM approve/reject controls for one pending request. */
export function DecideTimeAdjustmentButtons({ request, canExceed = false }: { request: PendingTimeAdjustment; /** the Owner may credit more hours than the clock shows */ canExceed?: boolean }) {
  const router = useRouter();
  const claimed = request.claimedHours && request.claimedHours > 0 && request.type !== "WEEKEND_WORK" ? request.claimedHours : null;
  const [hoursText, setHoursText] = useState(claimed !== null ? String(claimed) : "");
  const top = canExceed ? 16 : claimed ?? 0;
  const hours = claimed !== null ? Math.min(top, Math.max(0, Number(hoursText) || 0)) : null;
  const partial = claimed !== null && hours !== null && hours > 0 && hours < claimed;
  const more = claimed !== null && hours !== null && hours > claimed;
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  async function decide(action: "approve" | "reject") {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/time-adjustments/${request.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action === "approve" ? (partial || more ? { action, hours } : { action }) : { action, reason }),
    });
    setBusy(false);
    if (res.ok) {
      router.refresh();
    } else {
      setError((await res.json()).error ?? "Failed to save decision");
    }
  }

  if (rejecting) {
    return (
      <div className="space-y-2">
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
          rows={2}
          placeholder="Reason for rejecting…"
          className="text-xs"
        />
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setRejecting(false)} className="text-xs">
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={busy || !reason.trim()}
            onClick={() => decide("reject")}
            className="text-xs"
          >
            {busy ? "Saving…" : "Confirm reject"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {claimed !== null && (
        <div className="rounded-lg bg-ink-100 px-3 py-2 text-xs text-ink-700">
          {request.clockLabel && <div className="font-medium text-ink-900">{request.clockLabel}</div>}
          <div>
            Clocked <b>{claimed} h</b> {request.type === "OVERTIME" ? "after 5:00 PM" : "before the scheduled start"}.
          </div>
          <label className="mt-1.5 flex flex-wrap items-center gap-2">
            Pay only
            <input
              type="number"
              min="0.25"
              max={top}
              step="0.25"
              inputMode="decimal"
              value={hoursText}
              onChange={(e) => setHoursText(e.target.value)}
              aria-label="Hours to credit"
              className="min-h-[34px] w-20 rounded-md border border-ink-200 bg-ink-50 px-2 text-right tabular-nums text-ink-900 focus:border-[#8a1a28] focus:outline-none"
            />
            h {canExceed ? "" : "of it"}
            {partial && <span className="font-medium text-amber-700">— the other {Math.round((claimed - (hours ?? 0)) * 100) / 100} h will not be paid</span>}
            {more && <span className="font-medium text-amber-700">— {Math.round(((hours ?? 0) - claimed) * 100) / 100} h MORE than the clock shows</span>}
          </label>
          {!canExceed && Number(hoursText) > claimed && <p className="mt-1 text-amber-700">Only {claimed} h were clocked, so that is the most that can be credited. Only the Owner can credit more.</p>}
        </div>
      )}
      <div className="flex items-center gap-3">
      {error && <p className="text-xs text-red-600">{error}</p>}
      <button
        type="button"
        onClick={() => decide("approve")}
        disabled={busy || (claimed !== null && !(hours && hours > 0))}
        className="text-xs font-medium text-emerald-600 hover:underline disabled:opacity-50"
      >
        {partial || more ? `Approve ${hours} h` : "Approve"}
      </button>
      <button
        type="button"
        onClick={() => setRejecting(true)}
        disabled={busy}
        className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
      >
        Reject
      </button>
      </div>
    </div>
  );
}

export interface ApprovedHoursRow {
  id: string;
  employeeName: string;
  type: "EARLY_START" | "OVERTIME";
  shiftLabel: string;
  clockLabel: string;
  claimedHours: number;
  /** what was credited (claimed when the Owner approved all of it) */
  creditedHours: number;
}

/** Owner only: change how many hours were credited on a request that was already approved. */
export function EditApprovedHours({ row }: { row: ApprovedHoursRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [hoursText, setHoursText] = useState(String(row.creditedHours));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const hours = Math.min(16, Math.max(0, Number(hoursText) || 0));
  const more = hours > row.claimedHours;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch(`/api/time-adjustments/${row.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "edit_hours", hours, reason: reason.trim() }) });
    setBusy(false);
    if (res.ok) {
      setOpen(false);
      router.refresh();
    } else setError(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Failed to save");
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs font-medium text-brand-600 hover:underline">
        Change hours
      </button>
    );
  }
  return (
    <form onSubmit={save} className="mt-2 space-y-2 rounded-lg border border-ink-200 p-2">
      <label className="flex flex-wrap items-center gap-2 text-xs text-ink-700">
        Credit
        <input type="number" min="0.25" max="16" step="0.25" inputMode="decimal" value={hoursText} onChange={(e) => setHoursText(e.target.value)} aria-label="Hours to credit" className="min-h-[34px] w-20 rounded-md border border-ink-200 bg-ink-50 px-2 text-right tabular-nums text-ink-900 focus:border-[#8a1a28] focus:outline-none" />
        h ({row.claimedHours} h were clocked)
        {more && <span className="font-medium text-amber-700">— {Math.round((hours - row.claimedHours) * 100) / 100} h MORE than the clock shows</span>}
      </label>
      <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why? e.g., was waiting, not working — see photos" className="text-xs" required minLength={3} />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || hours <= 0 || reason.trim().length < 3} className="text-xs">
          {busy ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)} className="text-xs">
          Cancel
        </Button>
      </div>
    </form>
  );
}
