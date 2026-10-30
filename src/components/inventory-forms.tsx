"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { submitOrQueue } from "@/lib/outbox";
import { Button, Input, Label, Select } from "@/components/ui";
import { MATERIAL_CATEGORIES } from "@/lib/material-category";
import { ItemPicker } from "@/components/item-picker";
import { PhotoInput } from "@/components/photo-input";
import { WAREHOUSES, warehouseLabel, type WarehouseValue } from "@/lib/warehouses";
import { lineValue, parsePrice } from "@/lib/warehouse-value";
import type { PickItem } from "@/lib/item-search";

interface ItemOption {
  id: string;
  name: string;
  unit: string;
  category?: string;
  /** how many are in the warehouse */
  qty?: number;
  /** price per unit (only given to people who may see prices) */
  price?: number | null;
  /** the warehouse that keeps it */
  warehouse?: string;
}

interface ProjectOption {
  id: string;
  name: string;
}

/** Register a new warehouse stock item (Spec 6.4) in one of the four warehouses — the one being looked at is pre-selected. */
export function AddItemForm({ withPrice = false, warehouse = "MAIN" }: { withPrice?: boolean; warehouse?: WarehouseValue }) {
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
        warehouse: fd.get("warehouse"),
        unitPrice: parsePrice(String(fd.get("unitPrice") ?? "")) ?? null,
      }),
    });
    setBusy(false);
    if (res.ok) {
      (e.target as HTMLFormElement).reset?.();
      router.refresh();
    } else setError((await res.json()).error ?? "Failed to add item");
  }

  return (
    <form key={warehouse} onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-4">
      <div className="sm:col-span-4">
        <Label htmlFor="itemWarehouse">Add it to</Label>
        <Select id="itemWarehouse" name="warehouse" defaultValue={warehouse}>
          {WAREHOUSES.map((w) => (
            <option key={w.value} value={w.value}>
              {w.label}
            </option>
          ))}
        </Select>
      </div>
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
      {withPrice && (
        <div>
          <Label htmlFor="itemPrice">Price per unit (₱)</Label>
          <Input id="itemPrice" name="unitPrice" inputMode="decimal" placeholder="optional" />
        </div>
      )}
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
  { value: "SITE_TO_WAREHOUSE", label: "Site → Warehouse (return of unused / excess — needs approval)", from: true, to: false, warehouse: "Put it into" },
  { value: "SITE_TO_SITE", label: "Site → Site (direct transfer — needs approval)", from: true, to: true, warehouse: null },
  { value: "CONSUMED_ON_SITE", label: "Used on site (consumed)", from: true, to: false, warehouse: null },
  { value: "SUPPLIER_TO_WAREHOUSE", label: "Supplier → Warehouse", from: false, to: false, warehouse: "Deliver it into" },
] as const;

/**
 * Log a materials movement — offline-capable from the field (Spec 6.4).
 * Source/destination are picked from real projects (or Warehouse/Supplier),
 * so on-site balances per project stay accurate — no free-text locations.
 * Anything that goes into or out of a warehouse asks WHICH of the four warehouses. A return can also be of something the
 * warehouse does not have yet (it is added as part of the return), and of excess that was never logged on the site.
 */
export function MovementForm({
  items,
  projects,
  recentIds = [],
  instant = false,
  showValue = false,
  defaultWarehouse = "MAIN",
  canLogUsage = true,
}: {
  /** every stock item, with the warehouse that keeps it */
  items: ItemOption[];
  projects: ProjectOption[];
  /** show the value (quantity × price) of what is being logged — for people who may see prices */
  showValue?: boolean;
  /** the items this person logged most recently, newest first */
  recentIds?: string[];
  /** the Owner's returns and transfers are approved on the spot */
  instant?: boolean;
  /** the warehouse being looked at on the page — pre-selected */
  defaultWarehouse?: WarehouseValue;
  /** a person whose inventory is limited cannot log "used on site" */
  canLogUsage?: boolean;
}) {
  const router = useRouter();
  const [type, setType] = useState<(typeof MOVEMENT_TYPES)[number]["value"]>("SITE_TO_WAREHOUSE");
  const typeChoices = MOVEMENT_TYPES.filter((t) => canLogUsage || t.value !== "CONSUMED_ON_SITE");
  const [warehouse, setWarehouse] = useState<WarehouseValue>(defaultWarehouse);
  const [pickerKey, setPickerKey] = useState(0); // a new key clears the chosen item after each movement is logged
  const [chosen, setChosen] = useState<PickItem | null>(null);
  const [isNew, setIsNew] = useState(false); // the item is not in the warehouse's list yet (returns only)
  const [excessChecked, setExcessChecked] = useState(false);
  const [qtyText, setQtyText] = useState("");
  const [proof, setProof] = useState<string[]>([]); // photos of the items being returned / transferred
  const [proofKey, setProofKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  const rule = MOVEMENT_TYPES.find((t) => t.value === type)!;
  const usesWarehouse = rule.warehouse !== null;
  const canBeNew = type === "SITE_TO_WAREHOUSE";
  const warehouseName = warehouseLabel(warehouse);
  // into / out of a warehouse: that warehouse's items; between sites or used on site: any item, tagged with where it is kept
  const pickItems: PickItem[] = items
    .filter((i) => !usesWarehouse || (i.warehouse ?? "MAIN") === warehouse)
    .map((i) => ({ id: i.id, name: i.name, unit: i.unit, category: i.category ?? "OTHERS", qty: i.qty ?? 0, price: i.price ?? null, tag: usesWarehouse ? undefined : warehouseLabel(i.warehouse) }));
  const entryValue = chosen && !isNew ? lineValue(qtyText, chosen.price) : null;
  const pickerKeyFull = `${pickerKey}-${type}-${usesWarehouse ? warehouse : "any"}`; // the chosen item is cleared when the list changes

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMsg("");
    const fd = new FormData(e.currentTarget);
    const newItem = canBeNew && isNew ? { name: String(fd.get("newName") ?? "").trim(), unit: String(fd.get("newUnit") ?? "").trim(), category: String(fd.get("newCategory") ?? "OTHERS") } : null;
    if (newItem ? !newItem.name || !newItem.unit : !fd.get("itemId")) {
      setError(newItem ? "Type the item's name and unit." : "Choose an item first.");
      setBusy(false);
      return;
    }
    const result = await submitOrQueue({
      url: "/api/inventory/movements",
      label: "Inventory movement",
      body: {
        ...(newItem ? { newItem } : { itemId: fd.get("itemId") }),
        ...(usesWarehouse ? { warehouse } : {}),
        type,
        qty: Number(fd.get("qty")),
        fromProjectId: rule.from ? fd.get("fromProjectId") : undefined,
        toProjectId: rule.to ? fd.get("toProjectId") : undefined,
        note: fd.get("note") ?? "",
        ...(canBeNew && (excessChecked || isNew) ? { excess: true } : {}),
        ...(type === "SITE_TO_WAREHOUSE" || type === "SITE_TO_SITE" ? { photos: proof } : {}),
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
      setChosen(null);
      setIsNew(false);
      setExcessChecked(false);
      setQtyText("");
      setProof([]);
      setProofKey((k) => k + 1);
      if ((type === "SITE_TO_WAREHOUSE" || type === "SITE_TO_SITE") && !instant) {
        setMsg("Request sent — nothing moves until office staff approve it. See “Requests waiting for approval” at the top.");
      }
      router.refresh();
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div>
        <Label htmlFor="mvType">Movement type</Label>
        <Select
          id="mvType"
          value={type}
          onChange={(e) => {
            setType(e.target.value as typeof type);
            setChosen(null);
            setIsNew(false);
          }}
        >
          {typeChoices.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
      </div>

      {usesWarehouse && (
        <div>
          <Label htmlFor="mvWarehouse">{rule.warehouse} — which warehouse?</Label>
          <Select
            id="mvWarehouse"
            value={warehouse}
            onChange={(e) => {
              setWarehouse(e.target.value as WarehouseValue);
              setChosen(null);
            }}
          >
            {WAREHOUSES.map((w) => (
              <option key={w.value} value={w.value}>
                {w.label}
              </option>
            ))}
          </Select>
        </div>
      )}

      <div>
        <Label htmlFor="mvItem">Item</Label>
        {canBeNew && isNew ? (
          <div className="space-y-2 rounded-lg border border-dashed border-ink-200 p-3">
            <p className="text-xs text-ink-600">
              This item is not in the <b>{warehouseName}</b> list yet — it will be added there when the return is approved.
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="sm:col-span-3">
                <Label htmlFor="mvNewName">Item name</Label>
                <Input id="mvNewName" name="newName" placeholder="e.g., Portland cement" required />
              </div>
              <div>
                <Label htmlFor="mvNewUnit">Unit</Label>
                <Input id="mvNewUnit" name="newUnit" placeholder="bags" required />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="mvNewCat">Category</Label>
                <Select id="mvNewCat" name="newCategory" defaultValue="OTHERS">
                  {MATERIAL_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <button type="button" onClick={() => setIsNew(false)} className="text-xs font-medium text-brand-600 hover:underline">
              ← Choose from the list instead
            </button>
          </div>
        ) : (
          <>
            <ItemPicker key={pickerKeyFull} id="mvItem" items={pickItems} recentIds={recentIds} qtyNote={usesWarehouse ? `in ${warehouseName}` : "in its warehouse"} onChange={setChosen} />
            {canBeNew && (
              <button type="button" onClick={() => setIsNew(true)} className="mt-1 text-xs font-medium text-brand-600 hover:underline">
                ＋ The item isn’t in the {warehouseName} list yet — add it
              </button>
            )}
          </>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="mvQty">Qty</Label>
          <Input id="mvQty" name="qty" type="number" min="0.01" step="0.01" required value={qtyText} onChange={(e) => setQtyText(e.target.value)} />
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

      {canBeNew && !isNew && (
        <label className="flex cursor-pointer items-start gap-2 rounded-lg bg-ink-100 px-3 py-2 text-sm text-ink-800">
          <input type="checkbox" checked={excessChecked} onChange={(e) => setExcessChecked(e.target.checked)} className="mt-0.5 h-4 w-4" />
          <span>
            <b>Excess materials</b> — these were never logged on this site, so the site has no record of them. Keep them anyway.
            <span className="block text-xs text-ink-500">Without this, a return can only be as much as the site has on record.</span>
          </span>
        </label>
      )}
      {canBeNew && isNew && <p className="text-xs text-ink-500">A new item has no site record, so it is logged as excess materials.</p>}

      {showValue && chosen && !isNew && (
        <p className="rounded-lg bg-ink-100 px-3 py-2 text-sm text-ink-800" aria-live="polite">
          {chosen.price == null ? (
            <span className="text-ink-500">No price has been entered for this item yet, so this movement has no value.</span>
          ) : entryValue != null && Number(qtyText) > 0 ? (
            <>
              {type === "SITE_TO_WAREHOUSE" ? "Back into the warehouse: " : "Value: "}
              <b className="tabular-nums">₱{entryValue.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b>
              <span className="text-ink-500">
                {" "}
                ({Number(qtyText)} × ₱{chosen.price.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
              </span>
            </>
          ) : (
            <span className="text-ink-500">Enter a quantity to see its value (₱{chosen.price.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} each).</span>
          )}
        </p>
      )}
      {(type === "SITE_TO_WAREHOUSE" || type === "SITE_TO_SITE") && (
        <div>
          <PhotoInput key={proofKey} label="Photo of the items being moved (recommended — the approver sees it)" max={4} onChange={setProof} />
        </div>
      )}
      <div>
        <Label htmlFor="mvNote">Note (optional)</Label>
        <Input id="mvNote" name="note" placeholder="e.g., poured column C4" />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {msg && <p className="text-sm text-amber-600">{msg}</p>}
      <Button type="submit" disabled={busy || projects.length === 0}>
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
  canLogUsage = true,
}: {
  projectId: string;
  stocks: OnSiteStockRow[];
  otherProjects: ProjectOption[];
  /** the Owner's returns and transfers are approved on the spot */
  instant?: boolean;
  /** a person whose inventory is limited cannot log usage */
  canLogUsage?: boolean;
}) {
  const router = useRouter();
  const [action, setAction] = useState<"usage" | "return" | "transfer">(canLogUsage ? "usage" : "return");
  const [pickerKey, setPickerKey] = useState(0);
  const pickItems = stocks.map((st) => ({ id: st.itemId, name: st.name, unit: st.unit, category: st.category ?? "OTHERS", qty: st.qty }));
  const [proof, setProof] = useState<string[]>([]);
  const [proofKey, setProofKey] = useState(0);
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
        note: fd.get("note") ?? "",
        ...(action !== "usage" ? { photos: proof } : {}),
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
      setProof([]);
      setProofKey((k) => k + 1);
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
          {canLogUsage && <option value="usage">Log usage</option>}
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
      {action !== "usage" && (
        <div className="sm:col-span-5">
          <PhotoInput key={proofKey} label="Photo of the items being moved (recommended — the approver sees it)" max={4} onChange={setProof} />
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
