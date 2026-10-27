"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label } from "@/components/ui";
import { php } from "@/lib/format";
import { matchWarehouseStock, planWarehouseUse, type StockOption } from "@/lib/requisition-warehouse";
import { warehouseLabel } from "@/lib/warehouses";

async function patch(id: string, body: unknown): Promise<string | null> {
  const res = await fetch(`/api/requisitions/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.ok) return null;
  return (await res.json()).error ?? "Action failed";
}

export interface CostableQuote {
  id: string;
  supplier: string;
  unitCost: number;
  notes: string | null;
  submittedByName: string;
}

export interface CostableItem {
  id: string;
  name: string;
  spec: string | null;
  qty: number;
  unit: string;
  estUnitCost: number | null;
  remarks: string | null;
  quotes: CostableQuote[];
  selectedQuoteId: string | null;
  /** taken from warehouse stock instead of bought */
  warehouse?: { itemId: string; warehouse: string; currentQty: number; unitPrice: number | null; issued: boolean } | null;
}

/** An item that comes from the warehouse (no quotes needed), or — while the requisition is being costed — a hint that the
 * warehouse already holds what is being asked for, with a one-click way to use it. */
function ItemWarehouse({
  requisitionId,
  item,
  editable,
  canUseStock,
  stock,
}: {
  requisitionId: string;
  item: CostableItem;
  editable: boolean;
  canUseStock: boolean;
  stock: StockOption[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function act(body: unknown) {
    setBusy(true);
    setError("");
    const err = await patch(requisitionId, body);
    setBusy(false);
    if (err) setError(err);
    else router.refresh();
  }

  const w = item.warehouse;
  if (w) {
    const short = !w.issued && item.qty > w.currentQty;
    return (
      <div className="space-y-2 rounded-lg bg-emerald-50 p-2.5 text-sm text-emerald-800">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>
            <strong>From the warehouse</strong> — {warehouseLabel(w.warehouse)}.{" "}
            {w.issued
              ? "Already issued to the site (it is in the material movement log)."
              : `${w.currentQty} ${item.unit} in stock. Issued to the site automatically when the Owner approves; no purchase needed.`}
            {w.unitPrice != null && ` Value ${php(item.qty * w.unitPrice)} (${php(w.unitPrice)} each) — charged to the project when issued.`}
          </span>
          {editable && !w.issued && (
            <Button variant="ghost" disabled={busy} onClick={() => act({ action: "use_supplier", itemId: item.id })}>
              Buy it instead
            </Button>
          )}
        </div>
        {short && (
          <p className="rounded bg-amber-100 p-2 text-amber-900">
            Only {w.currentQty} {item.unit} in stock but {item.qty} are needed — approval will be refused until the quantity is fixed.
          </p>
        )}
        {error && <p className="text-red-600">{error}</p>}
      </div>
    );
  }

  const hits = editable && canUseStock ? matchWarehouseStock(item.name, stock).filter((x) => x.currentQty > 0) : [];
  if (hits.length === 0) return null;
  return (
    <div className="space-y-1 rounded-lg bg-sky-50 p-2.5 text-sm text-sky-900">
      <p className="text-xs font-semibold uppercase tracking-wide">The warehouse has this</p>
      {hits.map((x) => {
        const { fromWarehouse, toBuy } = planWarehouseUse(item.qty, x.currentQty);
        return (
          <div key={x.id} className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {x.name} — {warehouseLabel(x.warehouse)}: <strong>{x.currentQty} {x.unit} in stock</strong>
            </span>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => act({ action: "use_warehouse", itemId: item.id, warehouseItemId: x.id, qty: fromWarehouse })}
            >
              {toBuy > 0 ? `Take ${fromWarehouse}, buy the other ${toBuy}` : "Take from warehouse"}
            </Button>
          </div>
        );
      })}
      {error && <p className="text-red-600">{error}</p>}
    </div>
  );
}

/** One item's canvassing sheet: every supplier quote recorded so far, an
 * inline form to add another, and a way to pick which one to approve. */
function ItemQuotes({
  requisitionId,
  item,
  editable,
}: {
  requisitionId: string;
  item: CostableItem;
  editable: boolean;
}) {
  const router = useRouter();
  const [supplier, setSupplier] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function addQuote(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const err = await patch(requisitionId, {
      action: "add_quote",
      itemId: item.id,
      supplier,
      unitCost: Number(unitCost) || 0,
      notes,
    });
    setBusy(false);
    if (err) {
      setError(err);
    } else {
      setSupplier("");
      setUnitCost("");
      setNotes("");
      router.refresh();
    }
  }

  async function selectQuote(quoteId: string) {
    setBusy(true);
    setError("");
    const err = await patch(requisitionId, { action: "select_quote", itemId: item.id, quoteId });
    setBusy(false);
    if (err) setError(err);
    else router.refresh();
  }

  return (
    <div className="space-y-2">
      {item.quotes.length > 0 && (
        <div className="space-y-1">
          {item.quotes.map((q) => {
            const selected = q.id === item.selectedQuoteId;
            return (
              <div
                key={q.id}
                className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${
                  selected ? "border-brand-300 bg-brand-50" : "border-ink-100"
                }`}
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                  <span className="font-medium text-ink-800">{q.supplier}</span>
                  <span className="tabular-nums text-ink-600">
                    {php(q.unitCost)}/{item.unit} · {php(q.unitCost * item.qty)} total
                  </span>
                  <span className="text-ink-400">by {q.submittedByName}</span>
                  {q.notes && <span className="text-ink-400">— {q.notes}</span>}
                </div>
                {editable &&
                  (selected ? (
                    <span className="font-medium text-brand-700">✓ Selected</span>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => selectQuote(q.id)}
                      className="font-medium text-brand-600 hover:underline disabled:opacity-50"
                    >
                      Select this
                    </button>
                  ))}
                {!editable && selected && <span className="font-medium text-brand-700">✓ Selected</span>}
              </div>
            );
          })}
        </div>
      )}
      {item.quotes.length === 0 && (
        <p className="text-xs text-ink-400">No pricing recorded yet.</p>
      )}
      {editable && (
        <form onSubmit={addQuote} className="flex flex-wrap items-end gap-2 pt-1">
          <div>
            <Label className="mb-1 text-[11px]" htmlFor={`sup-${item.id}`}>
              Supplier
            </Label>
            <Input
              id={`sup-${item.id}`}
              className="h-8 w-36 text-xs"
              placeholder="e.g. ABC Hardware"
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
              required
            />
          </div>
          <div>
            <Label className="mb-1 text-[11px]" htmlFor={`cost-${item.id}`}>
              Price/unit
            </Label>
            <Input
              id={`cost-${item.id}`}
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              className="h-8 w-24 text-xs"
              value={unitCost}
              onChange={(e) => setUnitCost(e.target.value)}
              required
            />
          </div>
          <div>
            <Label className="mb-1 text-[11px]" htmlFor={`notes-${item.id}`}>
              Notes (optional)
            </Label>
            <Input
              id={`notes-${item.id}`}
              className="h-8 w-36 text-xs"
              placeholder="e.g. 3-day lead time"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <Button type="submit" variant="secondary" disabled={busy} className="h-8 px-3 text-xs">
            {busy ? "Adding…" : "+ Add quote"}
          </Button>
        </form>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

/**
 * Requested items, doubling as the canvassing sheet (Spec 6.2): whoever is
 * pricing the order (Purchasing, PM, Accounting, Owner) can record a quote
 * from more than one supplier per item, then choose which one to approve —
 * the subtotal and grand total always reflect whichever quote is currently
 * selected. Once costed, everyone reviewing the requisition (including the
 * Owner approving it) sees the same breakdown, with every quote considered
 * still visible for context.
 */
export function ItemsCostingTable({
  requisitionId,
  items,
  editable,
  canUseStock = false,
  stock = [],
}: {
  requisitionId: string;
  items: CostableItem[];
  editable: boolean;
  /** the requisition is charged to a project, so its items can be taken from the warehouse */
  canUseStock?: boolean;
  stock?: StockOption[];
}) {
  const total = items.filter((it) => !it.warehouse).reduce((s, it) => s + it.qty * (it.estUnitCost ?? 0), 0);
  const stockValue = items.reduce((s, it) => s + (it.warehouse?.unitPrice != null ? it.qty * it.warehouse.unitPrice : 0), 0);

  return (
    <div className="divide-y divide-ink-100">
      {items.map((it) => (
        <div key={it.id} className="space-y-2 p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <span className="font-medium text-ink-900">{it.name}</span>
              {it.spec && <span className="ml-2 text-xs text-ink-500">{it.spec}</span>}
            </div>
            <span className="text-xs text-ink-500">
              {it.qty} {it.unit}
            </span>
          </div>
          <ItemWarehouse requisitionId={requisitionId} item={it} editable={editable} canUseStock={canUseStock} stock={stock} />
          {!it.warehouse && <ItemQuotes requisitionId={requisitionId} item={it} editable={editable} />}
        </div>
      ))}
      <div className="flex items-center justify-between p-3 font-semibold">
        <span>Total to buy</span>
        <span className="tabular-nums">{php(total)}</span>
      </div>
      {stockValue > 0 && (
        <div className="flex items-center justify-between p-3 text-sm text-ink-600">
          <span>Taken from the warehouse (charged to the project when issued, not part of the purchase)</span>
          <span className="tabular-nums">{php(stockValue)}</span>
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

/**
 * Owner-only PO cancel — available while the PO isn't fully delivered yet
 * (Spec §3). Sends the requisition back to Approved so a corrected PO can
 * be issued; doesn't touch any delivery history already recorded.
 */
export function CancelPoButton({
  poId,
  compact = false,
}: {
  poId: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onCancel() {
    if (
      !confirm(
        "Cancel this purchase order? The requisition goes back to Approved so a corrected PO can be issued."
      )
    )
      return;
    setBusy(true);
    setError("");
    const res = await fetch(`/api/purchase-orders/${poId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "cancel" }),
    });
    setBusy(false);
    if (res.ok) router.refresh();
    else setError((await res.json()).error ?? "Failed to cancel");
  }

  return (
    <div className={compact ? "" : "space-y-1"}>
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        className={
          compact
            ? "text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
            : "text-sm font-medium text-red-600 hover:underline disabled:opacity-50"
        }
      >
        {busy ? "Cancelling…" : "Cancel PO"}
      </button>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
