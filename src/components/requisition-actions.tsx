"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label, Table, Td, Th } from "@/components/ui";
import { php } from "@/lib/format";

async function patch(id: string, body: unknown): Promise<string | null> {
  const res = await fetch(`/api/requisitions/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.ok) return null;
  return (await res.json()).error ?? "Action failed";
}

export interface CostableItem {
  id: string;
  name: string;
  spec: string | null;
  qty: number;
  unit: string;
  estUnitCost: number | null;
  remarks: string | null;
}

/**
 * Requested items, doubling as the canvassing sheet (Spec 6.2): whoever is
 * pricing the order (Purchasing, PM, Accounting, Owner) enters a per-item
 * unit price and which supplier it's from — the subtotal and grand total
 * compute themselves. Once costed, everyone reviewing the requisition
 * (including the Owner approving it) sees the same breakdown read-only.
 */
export function ItemsCostingTable({
  requisitionId,
  items,
  editable,
}: {
  requisitionId: string;
  items: CostableItem[];
  editable: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(
    items.map((i) => ({
      unitCost: i.estUnitCost != null ? String(i.estUnitCost) : "",
      remarks: i.remarks ?? "",
    }))
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function update(i: number, patch: Partial<{ unitCost: string; remarks: string }>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  const subtotal = (i: number) => items[i].qty * (Number(rows[i].unitCost) || 0);
  const total = items.reduce((s, _i, i) => s + subtotal(i), 0);

  async function onSave() {
    setBusy(true);
    setError("");
    const err = await patch(requisitionId, {
      action: "review",
      items: items.map((it, i) => ({
        id: it.id,
        unitCost: Number(rows[i].unitCost) || 0,
        remarks: rows[i].remarks,
      })),
    });
    setBusy(false);
    if (err) setError(err);
    else router.refresh();
  }

  return (
    <div>
      <Table>
        <thead>
          <tr>
            <Th>Item</Th>
            <Th>Specification</Th>
            <Th className="text-right">Qty</Th>
            <Th>Unit</Th>
            <Th className="text-right">Price/unit</Th>
            <Th className="text-right">Subtotal</Th>
            <Th>Remarks (supplier)</Th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={it.id}>
              <Td className="font-medium">{it.name}</Td>
              <Td className="text-ink-500">{it.spec ?? "—"}</Td>
              <Td className="text-right tabular-nums">{it.qty}</Td>
              <Td>{it.unit}</Td>
              <Td className="text-right">
                {editable ? (
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    className="ml-auto w-28 text-right"
                    value={rows[i].unitCost}
                    onChange={(e) => update(i, { unitCost: e.target.value })}
                  />
                ) : it.estUnitCost != null ? (
                  php(it.estUnitCost)
                ) : (
                  "—"
                )}
              </Td>
              <Td className="text-right tabular-nums">{php(subtotal(i))}</Td>
              <Td>
                {editable ? (
                  <Input
                    placeholder="e.g. ABC Hardware"
                    className="w-40"
                    value={rows[i].remarks}
                    onChange={(e) => update(i, { remarks: e.target.value })}
                  />
                ) : (
                  it.remarks ?? "—"
                )}
              </Td>
            </tr>
          ))}
          <tr className="border-t-2 border-ink-200 font-semibold">
            <Td colSpan={5} className="text-right">
              Total
            </Td>
            <Td className="text-right tabular-nums">{php(total)}</Td>
            <Td />
          </tr>
        </tbody>
      </Table>
      {editable && (
        <div className="flex items-center gap-3 border-t border-ink-100 p-3">
          <Button type="button" variant="secondary" disabled={busy} onClick={onSave}>
            {busy ? "Saving…" : "Save costing"}
          </Button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      )}
    </div>
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
  initialItems: { name: string; qty: number; unit: string; unitCost?: number | null }[];
}) {
  const router = useRouter();
  const [items, setItems] = useState<PoItem[]>(
    initialItems.map((i) => ({ ...i, unitCost: i.unitCost != null ? String(i.unitCost) : "0" }))
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

/**
 * Owner-only delete (Spec §3). Not exposed to any other role — the
 * requisitions list/detail pages only render this button when
 * user.role === "OWNER".
 */
export function DeleteRequisitionButton({
  requisitionId,
  redirectTo,
  compact = false,
}: {
  requisitionId: string;
  /** Where to navigate after a successful delete (detail page use). Omit to just refresh in place (list page use). */
  redirectTo?: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onDelete() {
    if (!confirm("Delete this requisition? This cannot be undone.")) return;
    setBusy(true);
    setError("");
    const res = await fetch(`/api/requisitions/${requisitionId}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) {
      if (redirectTo) router.push(redirectTo);
      else router.refresh();
    } else {
      setError((await res.json()).error ?? "Failed to delete");
    }
  }

  return (
    <div className={compact ? "" : "space-y-1"}>
      <button
        type="button"
        onClick={onDelete}
        disabled={busy}
        className={
          compact
            ? "text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
            : "text-sm font-medium text-red-600 hover:underline disabled:opacity-50"
        }
      >
        {busy ? "Deleting…" : "Delete"}
      </button>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
