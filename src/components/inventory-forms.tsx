"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { submitOrQueue } from "@/lib/outbox";
import { Button, Input, Label, Select } from "@/components/ui";
import { MATERIAL_CATEGORIES } from "@/lib/material-category";
import { ItemPicker } from "@/components/item-picker";

interface ItemOption {
  id: string;
  name: string;
  unit: string;
  category?: string;
  /** how many are in the warehouse */
  qty?: number;
}

interface ProjectOption {
  id: string;
  name: string;
}

/** Register a new warehouse stock item (Spec 6.4). */
export function AddItemForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const fd = new FormData(e.currentTarget);
    const res = await fetch("/api/inventory/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: fd.get("name"),
        unit: fd.get("unit"),
        currentQty: fd.get("currentQty"),
        category: fd.get("category"),
      }),
    });
    setBusy(false);
    if (res.ok) {
      (e.target as HTMLFormElement).reset?.();
      router.refresh();
    } else setError((await res.json()).error ?? "Failed to add item");
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-4">
      <div className="sm:col-span-2">
        <Label htmlFor="itemName">Item name</Label>
        <Input id="itemName" name="name" required placeholder="e.g., GI pipe 2 inch" />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="itemCategory">Category</Label>
        <Select id="itemCategory" name="category" required defaultValue="">
          <option value="" disabled>
            Choose a category…
          </option>
          {MATERIAL_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="itemUnit">Unit</Label>
        <Input id="itemUnit" name="unit" required placeholder="pcs" />
      </div>
      <div>
        <Label htmlFor="itemQty">Starting qty</Label>
        <Input id="itemQty" name="currentQty" type="number" min="0" step="0.01" defaultValue={0} />
      </div>
      {error && <p className="text-sm text-red-600 sm:col-span-4">{error}</p>}
      <div className="sm:col-span-4">
        <Button type="submit" variant="secondary" disabled={busy}>
          {busy ? "Adding…" : "+ Add stock item"}
        </Button>
      </div>
    </form>
  );
}

const MOVEMENT_TYPES = [
  { value: "WAREHOUSE_TO_SITE", label: "Warehouse → Site (issue to project)", from: false, to: true },
  { value: "SITE_TO_WAREHOUSE", label: "Site → Warehouse (return of unused — needs approval)", from: true, to: false },
  { value: "SITE_TO_SITE", label: "Site → Site (direct transfer — needs approval)", from: true, to: true },
  { value: "CONSUMED_ON_SITE", label: "Used on site (consumed)", from: true, to: false },
  { value: "SUPPLIER_TO_SITE", label: "Supplier → Site (direct delivery)", from: false, to: true },
  { value: "SUPPLIER_TO_WAREHOUSE", label: "Supplier → Warehouse", from: false, to: false },
] as const;

/**
 * Log a materials movement — offline-capable from the field (Spec 6.4).
 * Source/destination are picked from real projects (or Warehouse/Supplier),
 * so on-site balances per project stay accurate — no free-text locations.
 */
export function MovementForm({
  items,
  projects,
  recentIds = [],
  instant = false,
}: {
  items: ItemOption[];
  projects: ProjectOption[];
  /** the items this person logged most recently, newest first */
  recentIds?: string[];
  /** the Owner's returns and transfers are approved on the spot */
  instant?: boolean;
}) {
  const router = useRouter();
  const [type, setType] = useState<(typeof MOVEMENT_TYPES)[number]["value"]>("WAREHOUSE_TO_SITE");
  const [pickerKey, setPickerKey] = useState(0); // a new key clears the chosen item after each movement is logged
  const pickItems = items.map((i) => ({ id: i.id, name: i.name, unit: i.unit, category: i.category ?? "OTHERS", qty: i.qty ?? 0 }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  const rule = MOVEMENT_TYPES.find((t) => t.value === type)!;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMsg("");
    const fd = new FormData(e.currentTarget);
    if (!fd.get("itemId")) {
      setError("Choose an item first.");
      setBusy(false);
      return;
    }
    const result = await submitOrQueue({
      url: "/api/inventory/movements",
      label: "Inventory movement",
      body: {
        itemId: fd.get("itemId"),
        type,
        qty: Number(fd.get("qty")),
        fromProjectId: rule.from ? fd.get("fromProjectId") : undefined,
        toProjectId: rule.to ? fd.get("toProjectId") : undefined,
        note: fd.get("note"),
      },
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Failed to log movement");
      return;
    }
    if (result.queued) {
      setMsg("No signal — movement saved on this device and will sync automatically.");
    } else {
      (e.target as HTMLFormElement).reset?.();
      setPickerKey((k) => k + 1);
      if ((type === "SITE_TO_WAREHOUSE" || type === "SITE_TO_SITE") && !instant) {
        setMsg("Request sent — nothing moves until office staff approve it. See “Requests waiting for approval” at the top.");
      }
      router.refresh();
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="mvItem">Item</Label>
          <ItemPicker key={pickerKey} id="mvItem" items={pickItems} recentIds={recentIds} qtyNote="in warehouse" />
        </div>
        <div>
          <Label htmlFor="mvType">Movement type</Label>
          <Select
            id="mvType"
            value={type}
            onChange={(e) => setType(e.target.value as typeof type)}
          >
            {MOVEMENT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="mvQty">Qty</Label>
          <Input id="mvQty" name="qty" type="number" min="0.01" step="0.01" required />
        </div>
        {rule.from && (
          <div>
            <Label htmlFor="mvFromProject">From project</Label>
            <Select id="mvFromProject" name="fromProjectId" required>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
        )}
        {rule.to && (
          <div>
            <Label htmlFor="mvToProject">To project</Label>
            <Select id="mvToProject" name="toProjectId" required>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
        )}
      </div>
      <div>
        <Label htmlFor="mvNote">Note (optional)</Label>
        <Input id="mvNote" name="note" placeholder="e.g., poured column C4" />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {msg && <p className="text-sm text-amber-600">{msg}</p>}
      <Button type="submit" disabled={busy || items.length === 0 || projects.length === 0}>
        {busy ? "Logging…" : "Log movement"}
      </Button>
    </form>
  );
}

export interface OnSiteStockRow {
  itemId: string;
  name: string;
  unit: string;
  qty: number;
  category?: string;
}

/**
 * Per-project quick actions on the Inventory tab (owner's request,
 * 2026-07-07): log usage, return to warehouse, or transfer to another
 * project — scoped to this project and limited to items actually on site.
 */
export function ProjectMaterialQuickActions({
  projectId,
  stocks,
  otherProjects,
  instant = false,
}: {
  projectId: string;
  stocks: OnSiteStockRow[];
  otherProjects: ProjectOption[];
  /** the Owner's returns and transfers are approved on the spot */
  instant?: boolean;
}) {
  const router = useRouter();
  const [action, setAction] = useState<"usage" | "return" | "transfer">("usage");
  const [pickerKey, setPickerKey] = useState(0);
  const pickItems = stocks.map((st) => ({ id: st.itemId, name: st.name, unit: st.unit, category: st.category ?? "OTHERS", qty: st.qty }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  const typeFor = { usage: "CONSUMED_ON_SITE", return: "SITE_TO_WAREHOUSE", transfer: "SITE_TO_SITE" } as const;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMsg("");
    const fd = new FormData(e.currentTarget);
    if (!fd.get("itemId")) {
      setError("Choose an item first.");
      setBusy(false);
      return;
    }
    const result = await submitOrQueue({
      url: "/api/inventory/movements",
      label: `Material ${action}`,
      body: {
        itemId: fd.get("itemId"),
        type: typeFor[action],
        qty: Number(fd.get("qty")),
        fromProjectId: projectId,
        toProjectId: action === "transfer" ? fd.get("toProjectId") : undefined,
        note: fd.get("note"),
      },
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Failed");
      return;
    }
    if (result.queued) setMsg("Saved offline — will sync automatically.");
    else {
      (e.target as HTMLFormElement).reset?.();
      setPickerKey((k) => k + 1);
      if (action !== "usage" && !instant) setMsg("Request sent — nothing moves until office staff approve it.");
      router.refresh();
    }
  }

  if (stocks.length === 0) return null;

  return (
    <form onSubmit={onSubmit} className="mt-3 grid gap-2 rounded-lg border border-dashed border-ink-200 p-3 sm:grid-cols-5">
      <div className="sm:col-span-2">
        <Label>Item</Label>
        <ItemPicker key={pickerKey} id={`qa-${projectId}`} items={pickItems} qtyNote="on site" />
      </div>
      <div>
        <Label>Action</Label>
        <Select value={action} onChange={(e) => setAction(e.target.value as typeof action)}>
          <option value="usage">Log usage</option>
          <option value="return">Return to warehouse (request)</option>
          <option value="transfer">Transfer to project (request)</option>
        </Select>
      </div>
      <div>
        <Label>Qty</Label>
        <Input name="qty" type="number" min="0.01" step="0.01" required />
      </div>
      {action === "transfer" ? (
        <div>
          <Label>To project</Label>
          <Select name="toProjectId" required>
            {otherProjects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
      ) : (
        <div>
          <Label>Note (optional)</Label>
          <Input name="note" placeholder="e.g., poured column C4" />
        </div>
      )}
      <div className="sm:col-span-5 flex items-center gap-3">
        <Button type="submit" variant="secondary" disabled={busy}>
          {busy ? "Saving…" : action === "usage" || instant ? "Save" : "Send"}
        </Button>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {msg && <p className="text-sm text-amber-600">{msg}</p>}
      </div>
    </form>
  );
}
