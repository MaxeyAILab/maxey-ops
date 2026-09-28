"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Textarea } from "@/components/ui";

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

export interface PendingTimeAdjustment {
  id: string;
  employeeName: string;
  type: "EARLY_START" | "OVERTIME";
  reason: string;
  shiftLabel: string; // e.g. "Sep 17, 2026, 6:45 AM"
  requestedByName: string;
}

/** Owner/PM approve/reject controls for one pending request. */
export function DecideTimeAdjustmentButtons({ request }: { request: PendingTimeAdjustment }) {
  const router = useRouter();
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
      body: JSON.stringify(action === "approve" ? { action } : { action, reason }),
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
    <div className="flex items-center gap-3">
      {error && <p className="text-xs text-red-600">{error}</p>}
      <button
        type="button"
        onClick={() => decide("approve")}
        disabled={busy}
        className="text-xs font-medium text-emerald-600 hover:underline disabled:opacity-50"
      >
        Approve
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
  );
}
