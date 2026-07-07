"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { submitOrQueue } from "@/lib/outbox";
import { Button, Input, Label, Select, Textarea } from "@/components/ui";
import { PhotoInput } from "@/components/photo-input";

interface TermOption {
  id: string;
  label: string;
  amount: number;
}

/** Accounting/Owner records a client payment (Spec 6.13). */
export function PaymentForm({
  projectId,
  terms,
}: {
  projectId: string;
  terms: TermOption[];
}) {
  const router = useRouter();
  const [attachments, setAttachments] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const fd = new FormData(e.currentTarget);
    const res = await fetch("/api/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        paymentTermId: fd.get("paymentTermId") || undefined,
        amount: fd.get("amount"),
        dateReceived: fd.get("dateReceived"),
        method: fd.get("method") || undefined,
        reference: fd.get("reference") || undefined,
        attachments,
      }),
    });
    setBusy(false);
    if (res.ok) {
      (e.target as HTMLFormElement).reset?.();
      setAttachments([]);
      router.refresh();
    } else setError((await res.json()).error ?? "Failed to record payment");
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="amount">Amount (PHP) *</Label>
          <Input id="amount" name="amount" type="number" min="0.01" step="0.01" required />
        </div>
        <div>
          <Label htmlFor="dateReceived">Date received *</Label>
          <Input
            id="dateReceived"
            name="dateReceived"
            type="date"
            required
            defaultValue={new Date().toISOString().slice(0, 10)}
          />
        </div>
      </div>
      <div>
        <Label htmlFor="paymentTermId">Applies to</Label>
        <Select id="paymentTermId" name="paymentTermId">
          <option value="">— Unassigned —</option>
          {terms.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label} (₱{t.amount.toLocaleString("en-PH")})
            </option>
          ))}
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="method">Method</Label>
          <Select id="method" name="method">
            <option value="Bank transfer">Bank transfer</option>
            <option value="Check">Check</option>
            <option value="Cash">Cash</option>
            <option value="GCash">GCash</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="reference">Reference #</Label>
          <Input id="reference" name="reference" />
        </div>
      </div>
      <PhotoInput
        label="Attachments — received check, acknowledgment receipt, PO payment receipt"
        onChange={setAttachments}
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? "Recording…" : "Record payment"}
      </Button>
    </form>
  );
}

/** Owner/PM logs a change order for client approval in the portal (Spec 6.8). */
export function ChangeOrderForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const fd = new FormData(e.currentTarget);
    const res = await fetch("/api/change-orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        title: fd.get("title"),
        description: fd.get("description"),
        costImpact: fd.get("costImpact"),
        timeImpactDays: fd.get("timeImpactDays"),
      }),
    });
    setBusy(false);
    if (res.ok) {
      (e.target as HTMLFormElement).reset?.();
      router.refresh();
    } else setError((await res.json()).error ?? "Failed to create change order");
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div>
        <Label htmlFor="title">Title *</Label>
        <Input id="title" name="title" required placeholder="e.g., Additional perimeter fence" />
      </div>
      <div>
        <Label htmlFor="description">Description / scope *</Label>
        <Textarea id="description" name="description" rows={3} required />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="costImpact">Cost impact (PHP)</Label>
          <Input id="costImpact" name="costImpact" type="number" step="0.01" defaultValue={0} />
        </div>
        <div>
          <Label htmlFor="timeImpactDays">Time impact (days)</Label>
          <Input id="timeImpactDays" name="timeImpactDays" type="number" defaultValue={0} />
        </div>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? "Sending…" : "Send to client for approval"}
      </Button>
    </form>
  );
}

/** PM/foreman daily progress entry — offline-capable, with photos (Spec 6.7). */
export function ProgressForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMsg("");
    const fd = new FormData(e.currentTarget);
    const result = await submitOrQueue({
      url: "/api/progress",
      label: "Progress update",
      body: {
        projectId,
        workItem: fd.get("workItem"),
        pctComplete: Number(fd.get("pctComplete")),
        notes: fd.get("notes"),
        photos,
      },
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Failed to save progress");
      return;
    }
    if (result.queued) {
      setMsg("Saved offline — will sync when you're back online.");
    } else {
      (e.target as HTMLFormElement).reset?.();
      setPhotos([]);
      router.refresh();
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="workItem">Work item</Label>
          <Input id="workItem" name="workItem" placeholder="e.g., Structural works" />
        </div>
        <div>
          <Label htmlFor="pctComplete">Overall % complete *</Label>
          <Input
            id="pctComplete"
            name="pctComplete"
            type="number"
            min="0"
            max="100"
            step="0.1"
            required
          />
        </div>
      </div>
      <div>
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" name="notes" rows={2} />
      </div>
      <PhotoInput label="Site photos" onChange={setPhotos} />
      {error && <p className="text-sm text-red-600">{error}</p>}
      {msg && <p className="text-sm text-amber-600">{msg}</p>}
      <Button type="submit" disabled={busy} variant="secondary" className="w-full">
        {busy ? "Saving…" : "Add progress update"}
      </Button>
    </form>
  );
}
