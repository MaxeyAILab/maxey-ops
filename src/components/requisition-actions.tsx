"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label } from "@/components/ui";

async function patch(id: string, body: unknown): Promise<string | null> {
  const res = await fetch(`/api/requisitions/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.ok) return null;
  return (await res.json()).error ?? "Action failed";
}

/** PM/Accounting completes costing before Owner approval (Spec 6.2). */
export function CostRequisitionForm({ requisitionId }: { requisitionId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const fd = new FormData(e.currentTarget);
    const err = await patch(requisitionId, {
      action: "review",
      estimatedCost: fd.get("estimatedCost"),
    });
    setBusy(false);
    if (err) setError(err);
    else router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex items-end gap-2">
      <div className="flex-1">
        <Label htmlFor="estimatedCost">Estimated total cost (PHP)</Label>
        <Input id="estimatedCost" name="estimatedCost" type="number" min="0" step="0.01" required />
      </div>
      <Button type="submit" variant="secondary" disabled={busy}>
        {busy ? "Saving…" : "Save costing"}
      </Button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  );
}

/** Owner-only approve / reject (Spec §3). */
export function ApproveRejectButtons({ requisitionId }: { requisitionId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  async function act(body: unknown) {
    setBusy(true);
    setError("");
    const err = await patch(requisitionId, body);
    setBusy(false);
    if (err) setError(err);
    else router.refresh();
  }

  if (rejecting) {
    return (
      <div className="space-y-2">
        <Label htmlFor="reason">Reason for rejection</Label>
        <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        <div className="flex gap-2">
          <Button
            variant="danger"
            disabled={busy || !reason.trim()}
            onClick={() => act({ action: "reject", reason })}
          >
            Confirm reject
          </Button>
          <Button variant="ghost" onClick={() => setRejecting(false)}>
            Cancel
          </Button>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Button variant="success" disabled={busy} onClick={() => act({ action: "approve" })}>
          ✓ Approve
        </Button>
        <Button variant="danger" disabled={busy} onClick={() => setRejecting(true)}>
          Reject
        </Button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

interface PoItem {
  name: string;
  qty: number;
  unit: string;
  unitCost: string;
}

/** Purchasing converts an approved requisition into a PO (Spec 6.2). */
export function CreatePoForm({
  requisitionId,
  initialItems,
}: {
  requisitionId: string;
  initialItems: { name: string; qty: number; unit: string }[];
}) {
  const router = useRouter();
  const [items, setItems] = useState<PoItem[]>(
    initialItems.map((i) => ({ ...i, unitCost: "0" }))
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const total = items.reduce((s, i) => s + i.qty * (Number(i.unitCost) || 0), 0);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const fd = new FormData(e.currentTarget);
    const res = await fetch("/api/purchase-orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requisitionId,
        supplier: fd.get("supplier"),
        deliveryDate: fd.get("deliveryDate") || undefined,
        items: items.map((i) => ({ ...i, unitCost: Number(i.unitCost) || 0 })),
      }),
    });
    setBusy(false);
    if (res.ok) router.refresh();
    else setError((await res.json()).error ?? "Failed to create PO");
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="supplier">Supplier *</Label>
          <Input id="supplier" name="supplier" required />
        </div>
        <div>
          <Label htmlFor="deliveryDate">Expected delivery</Label>
          <Input id="deliveryDate" name="deliveryDate" type="date" />
        </div>
      </div>
      <div className="space-y-2">
        {items.map((it, i) => (
          <div key={i} className="grid grid-cols-12 items-center gap-2 text-sm">
            <span className="col-span-6 text-ink-700">
              {it.qty} {it.unit} — {it.name}
            </span>
            <div className="col-span-4">
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="Unit cost"
                value={it.unitCost}
                onChange={(e) =>
                  setItems((prev) =>
                    prev.map((x, idx) => (idx === i ? { ...x, unitCost: e.target.value } : x))
                  )
                }
              />
            </div>
            <span className="col-span-2 text-right tabular-nums text-ink-500">
              ₱{(it.qty * (Number(it.unitCost) || 0)).toLocaleString("en-PH")}
            </span>
          </div>
        ))}
      </div>
      <div className="text-right text-sm font-bold text-ink-900">
        PO Total: ₱{total.toLocaleString("en-PH", { minimumFractionDigits: 2 })}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" disabled={busy || total === 0} className="w-full">
        {busy ? "Creating…" : "Issue Purchase Order"}
      </Button>
    </form>
  );
}
