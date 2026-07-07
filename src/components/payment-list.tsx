"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label, Select } from "@/components/ui";
import { PhotoInput } from "@/components/photo-input";
import { php } from "@/lib/format";

export interface PaymentRowData {
  id: string;
  amount: number;
  dateReceived: string; // yyyy-mm-dd
  method: string | null;
  reference: string | null;
  recordedByName: string;
  attachments: string[];
}

/**
 * Recorded payments with correction support: edit (audit-logged with
 * before/after), void, and proof-of-payment attachments (check photos,
 * acknowledgment receipts, PO payment receipts).
 */
export function PaymentList({
  payments,
  canEdit,
}: {
  payments: PaymentRowData[];
  canEdit: boolean;
}) {
  if (payments.length === 0) return null;
  return (
    <ul className="mt-4 space-y-2">
      {payments.map((p) => (
        <PaymentRow key={p.id} payment={p} canEdit={canEdit} />
      ))}
    </ul>
  );
}

function PaymentRow({ payment, canEdit }: { payment: PaymentRowData; canEdit: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<"view" | "edit" | "attach">("view");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/payments/${payment.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (res.ok) {
      setMode("view");
      setAttachments([]);
      router.refresh();
    } else {
      setError((await res.json()).error ?? "Update failed");
    }
  }

  async function voidPayment() {
    if (
      !confirm(
        `Void this ${php(payment.amount)} payment? The full record is kept in the audit trail.`
      )
    ) {
      return;
    }
    setBusy(true);
    const res = await fetch(`/api/payments/${payment.id}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) router.refresh();
    else alert((await res.json()).error ?? "Failed to void payment");
  }

  async function onEditSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await patch({
      amount: fd.get("amount"),
      dateReceived: fd.get("dateReceived"),
      method: fd.get("method"),
      reference: fd.get("reference"),
    });
  }

  return (
    <li className="rounded-lg border border-ink-100 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="font-semibold tabular-nums text-ink-900">{php(payment.amount)}</span>
          <span className="ml-2 text-xs text-ink-500">
            {payment.dateReceived} · {payment.method ?? "n/a"}
            {payment.reference && ` · ref ${payment.reference}`} · by {payment.recordedByName}
          </span>
        </div>
        {canEdit && mode === "view" && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setMode("attach")}
              className="rounded px-2 py-1 text-xs text-ink-600 hover:bg-ink-100"
            >
              📎 Attach
            </button>
            <button
              onClick={() => setMode("edit")}
              className="rounded px-2 py-1 text-xs text-ink-600 hover:bg-ink-100"
            >
              ✏️ Edit
            </button>
            <button
              onClick={voidPayment}
              disabled={busy}
              className="rounded px-2 py-1 text-xs text-red-500 hover:bg-red-50"
            >
              Void
            </button>
          </div>
        )}
      </div>

      {/* Proof-of-payment thumbnails */}
      {payment.attachments.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {payment.attachments.map((src) => (
            <a key={src} href={src} target="_blank" rel="noopener noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt="Payment proof"
                className="h-16 w-16 rounded-lg border border-ink-100 object-cover hover:opacity-80"
              />
            </a>
          ))}
        </div>
      )}

      {mode === "edit" && (
        <form onSubmit={onEditSubmit} className="mt-3 space-y-3 rounded-lg bg-ink-50 p-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Amount (PHP)</Label>
              <Input
                name="amount"
                type="number"
                min="0.01"
                step="0.01"
                defaultValue={payment.amount}
                required
              />
            </div>
            <div>
              <Label>Date received</Label>
              <Input name="dateReceived" type="date" defaultValue={payment.dateReceived} required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Method</Label>
              <Select name="method" defaultValue={payment.method ?? "Bank transfer"}>
                <option value="Bank transfer">Bank transfer</option>
                <option value="Check">Check</option>
                <option value="Cash">Cash</option>
                <option value="GCash">GCash</option>
              </Select>
            </div>
            <div>
              <Label>Reference #</Label>
              <Input name="reference" defaultValue={payment.reference ?? ""} />
            </div>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save correction"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setMode("view")}>
              Cancel
            </Button>
          </div>
          <p className="text-xs text-ink-400">
            Corrections are recorded in the audit trail with the before and after values.
          </p>
        </form>
      )}

      {mode === "attach" && (
        <div className="mt-3 space-y-3 rounded-lg bg-ink-50 p-3">
          <PhotoInput
            label="Attach proof — received check, acknowledgment receipt, PO payment receipt"
            onChange={setAttachments}
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <Button
              disabled={busy || attachments.length === 0}
              onClick={() => patch({ addAttachments: attachments })}
            >
              {busy ? "Uploading…" : `Save ${attachments.length || ""} attachment(s)`}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setMode("view")}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
