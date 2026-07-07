"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { submitOrQueue } from "@/lib/outbox";
import { Button, Input, Label, Select } from "@/components/ui";

interface ItemOption {
  id: string;
  name: string;
  unit: string;
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
  { value: "SITE_TO_WAREHOUSE", label: "Site → Warehouse (pullout of unused)", from: true, to: false },
  { value: "SITE_TO_SITE", label: "Site → Site (direct transfer)", from: true, to: true },
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
}: {
  items: ItemOption[];
  projects: ProjectOption[];
}) {
  const router = useRouter();
  const [type, setType] = useState<(typeof MOVEMENT_TYPES)[number]["value"]>("WAREHOUSE_TO_SITE");
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
      router.refresh();
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="mvItem">Item</Label>
          <Select id="mvItem" name="itemId" required>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} ({i.unit})
              </option>
            ))}
          </Select>
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
}: {
  projectId: string;
  stocks: OnSiteStockRow[];
  otherProjects: ProjectOption[];
}) {
  const router = useRouter();
  const [action, setAction] = useState<"usage" | "return" | "transfer">("usage");
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
      router.refresh();
    }
  }

  if (stocks.length === 0) return null;

  return (
    <form onSubmit={onSubmit} className="mt-3 grid gap-2 rounded-lg border border-dashed border-ink-200 p-3 sm:grid-cols-5">
      <div className="sm:col-span-2">
        <Label>Item</Label>
        <Select name="itemId" required>
          {stocks.map((s) => (
            <option key={s.itemId} value={s.itemId}>
              {s.name} — {s.qty} {s.unit} on site
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label>Action</Label>
        <Select value={action} onChange={(e) => setAction(e.target.value as typeof action)}>
          <option value="usage">Log usage</option>
          <option value="return">Return to warehouse</option>
          <option value="transfer">Transfer to project</option>
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
          {busy ? "Saving…" : "Save"}
        </Button>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {msg && <p className="text-sm text-amber-600">{msg}</p>}
      </div>
    </form>
  );
}
