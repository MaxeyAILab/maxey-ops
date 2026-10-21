"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label, Select } from "@/components/ui";
import { MATERIAL_CATEGORIES, type MaterialCategoryValue } from "@/lib/material-category";

/** A plain pop-up panel: closes with Escape or a click outside, and keeps the page behind it still. */
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-ink-50 p-5 shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-ink-900">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg px-2 py-1 text-ink-500 hover:bg-ink-100">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

async function patch(url: string, body: Record<string, unknown>): Promise<string | null> {
  const res = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (res.ok) return null;
  return ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Couldn't save";
}

/** Fix a warehouse stock item after it was added: name, unit, category, or the quantity (a quantity change needs a reason). */
export function EditStockItemButton({ id, name, unit, category, qty }: { id: string; name: string; unit: string; category: MaterialCategoryValue; qty: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [newQty, setNewQty] = useState(String(qty));
  const qtyChanged = Number(newQty) !== qty;

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    const err = await patch(`/api/inventory/items/${id}`, {
      name: fd.get("name"),
      unit: fd.get("unit"),
      category: fd.get("category"),
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
export function EditToolButton({ id, name, assetTag, category }: { id: string; name: string; assetTag: string | null; category: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    const err = await patch(`/api/tools/${id}`, { name: fd.get("name"), assetTag: fd.get("assetTag") ?? "", category: fd.get("category") ?? "" });
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
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor={`tt-${id}`}>Asset tag</Label>
                <Input id={`tt-${id}`} name="assetTag" defaultValue={assetTag ?? ""} placeholder="e.g., WM-002" />
              </div>
              <div>
                <Label htmlFor={`tc-${id}`}>Category</Label>
                <Input id={`tc-${id}`} name="category" defaultValue={category ?? ""} placeholder="Power Tool" list={`tool-cat-${id}`} />
                <datalist id={`tool-cat-${id}`}>
                  <option value="Power Tool" />
                  <option value="Heavy Equipment" />
                  <option value="Hand Tool" />
                  <option value="Safety Equipment" />
                </datalist>
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
