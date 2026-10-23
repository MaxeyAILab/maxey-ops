"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label, Select } from "@/components/ui";
import { Modal } from "@/components/modal";
import { MATERIAL_CATEGORIES, type MaterialCategoryValue } from "@/lib/material-category";
import { parsePrice } from "@/lib/warehouse-value";
import { WAREHOUSES, type WarehouseValue } from "@/lib/warehouses";
import { NO_TOOL_CATEGORY, TOOL_CATEGORIES, TOOL_CATEGORY_LABEL, toolCategoryKey } from "@/lib/tool-category";

async function patch(url: string, body: Record<string, unknown>): Promise<string | null> {
  const res = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (res.ok) return null;
  return ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Couldn't save";
}

/** Fix a warehouse stock item after it was added: name, unit, category, or the quantity (a quantity change needs a reason). */
export function EditStockItemButton({ id, name, unit, category, qty, price, canPrice = false, warehouse = "MAIN" }: { id: string; name: string; unit: string; category: MaterialCategoryValue; qty: number; price?: number | null; canPrice?: boolean; warehouse?: WarehouseValue }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [newQty, setNewQty] = useState(String(qty));
  const qtyChanged = Number(newQty) !== qty;

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    let unitPrice: number | null | undefined;
    if (canPrice) {
      unitPrice = parsePrice(String(fd.get("unitPrice") ?? ""));
      if (unitPrice === undefined) return setError("The price must be an amount like 150 or 1,250.50");
    }
    setBusy(true);
    setError("");
    const err = await patch(`/api/inventory/items/${id}`, {
      ...(unitPrice !== undefined ? { unitPrice } : {}),
      name: fd.get("name"),
      unit: fd.get("unit"),
      category: fd.get("category"),
      warehouse: fd.get("warehouse"),
      ...(qtyChanged ? { currentQty: Number(newQty), qtyReason: fd.get("qtyReason") } : {}),
    });
    setBusy(false);
    if (err) return setError(err);
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={`Edit ${name}`} className="text-xs font-medium text-brand-600 hover:underline">
        Edit
      </button>
      {open && (
        <Modal title={`Edit “${name}”`} onClose={() => setOpen(false)}>
          <form onSubmit={save} className="space-y-3">
            <div>
              <Label htmlFor={`en-${id}`}>Item name</Label>
              <Input id={`en-${id}`} name="name" required defaultValue={name} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor={`eu-${id}`}>Unit</Label>
                <Input id={`eu-${id}`} name="unit" required defaultValue={unit} />
              </div>
              <div>
                <Label htmlFor={`ec-${id}`}>Category</Label>
                <Select id={`ec-${id}`} name="category" defaultValue={category}>
                  {MATERIAL_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor={`ew-${id}`}>Kept in</Label>
              <Select id={`ew-${id}`} name="warehouse" defaultValue={warehouse}>
                {WAREHOUSES.map((w) => (
                  <option key={w.value} value={w.value}>
                    {w.label}
                  </option>
                ))}
              </Select>
              <p className="mt-1 text-xs text-ink-500">Change this only if the item was entered in the wrong warehouse — its quantity moves with it.</p>
            </div>
            {canPrice && (
              <div>
                <Label htmlFor={`ep-${id}`}>Price per unit (₱)</Label>
                <Input id={`ep-${id}`} name="unitPrice" inputMode="decimal" defaultValue={price == null ? "" : String(price)} placeholder="leave blank if not known" />
              </div>
            )}
            <div>
              <Label htmlFor={`eq-${id}`}>Quantity in the warehouse</Label>
              <Input id={`eq-${id}`} type="number" min="0" step="0.01" value={newQty} onChange={(e) => setNewQty(e.target.value)} />
              <p className="mt-1 text-xs text-ink-500">Normally the quantity changes through logged movements. Change it here only to correct a mistake.</p>
            </div>
            {qtyChanged && (
              <div>
                <Label htmlFor={`er-${id}`}>Why is the quantity being changed?</Label>
                <Input id={`er-${id}`} name="qtyReason" required minLength={3} placeholder="e.g., typed 50 instead of 5" />
              </div>
            )}
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save changes"}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

/** Fix a tool/equipment entry after it was added: name, asset tag, category (e.g. one that was forgotten). */
export function EditToolButton({ id, name, assetTag, category, warehouse = "MAIN" }: { id: string; name: string; assetTag: string | null; category: string | null; warehouse?: WarehouseValue }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    const err = await patch(`/api/tools/${id}`, { name: fd.get("name"), assetTag: fd.get("assetTag") ?? "", category: fd.get("category") ?? "", warehouse: fd.get("warehouse") });
    setBusy(false);
    if (err) return setError(err);
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={`Edit ${name}`} className="text-xs font-medium text-brand-600 hover:underline">
        Edit
      </button>
      {open && (
        <Modal title={`Edit “${name}”${assetTag ? ` (${assetTag})` : ""}`} onClose={() => setOpen(false)}>
          <form onSubmit={save} className="space-y-3">
            <div>
              <Label htmlFor={`tn-${id}`}>Tool / equipment name</Label>
              <Input id={`tn-${id}`} name="name" required defaultValue={name} />
            </div>
            <div>
              <Label htmlFor={`tw-${id}`}>Kept in</Label>
              <Select id={`tw-${id}`} name="warehouse" defaultValue={warehouse}>
                {WAREHOUSES.map((w) => (
                  <option key={w.value} value={w.value}>
                    {w.label}
                  </option>
                ))}
              </Select>
              <p className="mt-1 text-xs text-ink-500">Its home warehouse — where it sits when it is not on a project, and where it returns to.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor={`tt-${id}`}>Asset tag</Label>
                <Input id={`tt-${id}`} name="assetTag" defaultValue={assetTag ?? ""} placeholder="e.g., WM-002" />
              </div>
              <div>
                <Label htmlFor={`tc-${id}`}>Category</Label>
                <Select id={`tc-${id}`} name="category" defaultValue={toolCategoryKey(category) === NO_TOOL_CATEGORY ? "" : TOOL_CATEGORY_LABEL[toolCategoryKey(category)]}>
                  <option value="">Not categorized</option>
                  {TOOL_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.label}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save changes"}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
