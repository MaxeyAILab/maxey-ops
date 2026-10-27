"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { submitOrQueue } from "@/lib/outbox";
import { Button, Card, CardBody, Input, Label, Select, Textarea } from "@/components/ui";
import { NON_PROJECT_CATEGORIES } from "@/lib/requisitions";
import { useT } from "@/components/lang-provider";
import type { I18nKey } from "@/lib/i18n";
import { matchWarehouseStock, planWarehouseUse, type StockOption } from "@/lib/requisition-warehouse";
import { warehouseLabel } from "@/lib/warehouses";

const CATEGORY_PREFIX = "cat:";

interface ProjectOption {
  id: string;
  name: string;
  nonCorporate?: boolean;
}

interface Item {
  name: string;
  spec: string;
  qty: string;
  unit: string;
  /** taken from this warehouse item instead of bought */
  warehouseItemId?: string;
}

const CATEGORY_KEY: Record<string, I18nKey> = { OFFICE_SUPPLY: "req.catOffice", WAREHOUSE_SUPPLY: "req.catWarehouse", EMERGENCY: "req.catEmergency" };

const emptyItem = (): Item => ({ name: "", spec: "", qty: "1", unit: "pcs" });

/**
 * Field requisition form — works fully offline (Spec §4/6.2). When there is
 * no signal it queues to the IndexedDB outbox with the device timestamp and
 * syncs automatically when connectivity returns.
 */
export function RequisitionForm({ projects, stock = [] }: { projects: ProjectOption[]; stock?: StockOption[] }) {
  const t = useT();
  const [selection, setSelection] = useState(`${CATEGORY_PREFIX}${NON_PROJECT_CATEGORIES[0].value}`);
  const forProject = !selection.startsWith(CATEGORY_PREFIX);
  const stockById = new Map(stock.map((w) => [w.id, w]));
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([emptyItem()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [queuedMsg, setQueuedMsg] = useState("");

  function update(i: number, patch: Partial<Item>) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }

  function chooseCharge(value: string) {
    setSelection(value);
    // warehouse stock is issued to a project's site, so a general (G&A) requisition cannot take from it
    if (value.startsWith(CATEGORY_PREFIX)) setItems((prev) => prev.map((it) => ({ ...it, warehouseItemId: undefined })));
  }

  function useStock(i: number, w: StockOption) {
    update(i, { warehouseItemId: w.id, name: w.name, unit: w.unit });
  }

  /** asked for more than the warehouse holds: take what is there and keep a second line for the rest */
  function splitRow(i: number) {
    setItems((prev) => {
      const it = prev[i];
      const w = it.warehouseItemId ? stockById.get(it.warehouseItemId) : undefined;
      if (!w) return prev;
      const { fromWarehouse, toBuy } = planWarehouseUse(Number(it.qty), w.currentQty);
      if (fromWarehouse <= 0 || toBuy <= 0) return prev;
      const next = [...prev];
      next[i] = { ...it, qty: String(fromWarehouse) };
      next.splice(i + 1, 0, { name: w.name, spec: it.spec, qty: String(toBuy), unit: w.unit });
      return next;
    });
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const fd = new FormData(e.currentTarget);
    const validItems = items.filter((i) => i.name.trim());
    if (validItems.length === 0) {
      setError(t("req.needItem"));
      setBusy(false);
      return;
    }

    const isCategory = selection.startsWith(CATEGORY_PREFIX);

    const result = await submitOrQueue({
      url: "/api/requisitions",
      label: `Requisition: ${validItems.length} item(s)`,
      body: {
        projectId: isCategory ? undefined : selection,
        category: isCategory ? selection.slice(CATEGORY_PREFIX.length) : undefined,
        urgency: fd.get("urgency"),
        neededBy: fd.get("neededBy") || undefined,
        notes: fd.get("notes"),
        items: validItems,
      },
    });
    setBusy(false);

    if (!result.ok) {
      setError(result.error ?? t("req.failed"));
      return;
    }
    if (result.queued) {
      setQueuedMsg(t("req.queued"));
      return;
    }
    router.push("/requisitions");
    router.refresh();
  }

  if (queuedMsg) {
    return (
      <Card>
        <CardBody className="space-y-3 text-center">
          <p className="text-3xl">📥</p>
          <p className="font-semibold text-amber-700">{t("form.savedToOutbox")}</p>
          <p className="text-sm text-ink-600">{queuedMsg}</p>
          <Button variant="secondary" onClick={() => { setQueuedMsg(""); setItems([emptyItem()]); }}>
            {t("req.another")}
          </Button>
        </CardBody>
      </Card>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="projectId">{t("req.chargeTo")}</Label>
          <Select id="projectId" name="projectId" value={selection} onChange={(e) => chooseCharge(e.target.value)}>
            <optgroup label={t("req.ga")}>
              {NON_PROJECT_CATEGORIES.map((c) => (
                <option key={c.value} value={`${CATEGORY_PREFIX}${c.value}`}>
                  {t(CATEGORY_KEY[c.value] ?? "req.catEmergency")}
                </option>
              ))}
            </optgroup>
            {projects.some((p) => !p.nonCorporate) && (
              <optgroup label={t("req.projects")}>
                {projects
                  .filter((p) => !p.nonCorporate)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </optgroup>
            )}
            {projects.some((p) => p.nonCorporate) && (
              <optgroup label={t("req.nonCorporate")}>
                {projects
                  .filter((p) => p.nonCorporate)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </optgroup>
            )}
          </Select>
        </div>
        <div>
          <Label htmlFor="urgency">{t("req.urgency")}</Label>
          <Select id="urgency" name="urgency" defaultValue="NORMAL">
            <option value="LOW">{t("req.low")}</option>
            <option value="NORMAL">{t("req.normal")}</option>
            <option value="HIGH">{t("req.high")}</option>
            <option value="CRITICAL">{t("req.critical")}</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="neededBy">{t("req.neededBy")}</Label>
          <Input id="neededBy" name="neededBy" type="date" />
        </div>
      </div>

      <div className="space-y-3">
        <Label>{t("req.items")}</Label>
        {items.map((it, i) => {
          const linked = it.warehouseItemId ? stockById.get(it.warehouseItemId) : undefined;
          const suggestions = !linked && forProject ? matchWarehouseStock(it.name, stock) : [];
          const asked = Number(it.qty) || 0;
          const short = linked && asked > linked.currentQty;
          return (
            <div key={i} className="space-y-2 rounded-lg border border-ink-100 p-3">
              <div className="grid grid-cols-12 gap-2">
                <Input
                  placeholder={t("req.itemName")}
                  value={it.name}
                  readOnly={!!linked}
                  onChange={(e) => update(i, { name: e.target.value })}
                  className="col-span-12 sm:col-span-6"
                />
                <Input
                  type="number"
                  min="0.01"
                  step="0.01"
                  inputMode="decimal"
                  placeholder={t("req.qty")}
                  value={it.qty}
                  onChange={(e) => update(i, { qty: e.target.value })}
                  className="col-span-4 sm:col-span-2"
                />
                <Input
                  placeholder={t("req.unit")}
                  value={it.unit}
                  readOnly={!!linked}
                  onChange={(e) => update(i, { unit: e.target.value })}
                  className="col-span-5 sm:col-span-3"
                />
                <button
                  type="button"
                  onClick={() => setItems((prev) => prev.filter((_, idx) => idx !== i))}
                  className="col-span-3 sm:col-span-1 min-h-[44px] rounded-lg text-red-500 hover:bg-red-50"
                  aria-label={t("req.removeItem")}
                >
                  ✕
                </button>
              </div>
              <Input
                placeholder={t("req.spec")}
                value={it.spec}
                onChange={(e) => update(i, { spec: e.target.value })}
              />
              {linked && (
                <div className="space-y-2 rounded-lg bg-emerald-50 p-2.5 text-sm text-emerald-800">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <strong>From the warehouse</strong> — {warehouseLabel(linked.warehouse)}: {linked.currentQty} {linked.unit} in stock. It is taken out of the stock automatically when this is approved, so nothing needs to be bought.
                    </span>
                    <button type="button" className="rounded px-2 py-1 text-xs font-medium text-emerald-900 underline" onClick={() => update(i, { warehouseItemId: undefined })}>
                      Buy it instead
                    </button>
                  </div>
                  {short && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded bg-amber-100 p-2 text-amber-900">
                      <span>
                        Only {linked.currentQty} {linked.unit} in stock, you asked for {asked}. Approval is blocked until this is fixed.
                      </span>
                      {linked.currentQty > 0 && (
                        <button type="button" className="rounded bg-amber-200 px-2 py-1 text-xs font-semibold" onClick={() => splitRow(i)}>
                          Take {linked.currentQty}, buy the other {Math.round((asked - linked.currentQty) * 100) / 100}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
              {suggestions.length > 0 && (
                <div className="space-y-1 rounded-lg bg-sky-50 p-2.5 text-sm text-sky-900">
                  <p className="text-xs font-semibold uppercase tracking-wide">In the warehouse</p>
                  {suggestions.map((w) => (
                    <div key={w.id} className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        {w.name} — {warehouseLabel(w.warehouse)}:{" "}
                        {w.currentQty > 0 ? <strong>{w.currentQty} {w.unit} in stock</strong> : <span className="text-sky-700">none in stock</span>}
                      </span>
                      {w.currentQty > 0 && (
                        <button type="button" className="rounded bg-sky-200 px-2 py-1 text-xs font-semibold" onClick={() => useStock(i, w)}>
                          Take from warehouse
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        <Button type="button" variant="secondary" onClick={() => setItems((p) => [...p, emptyItem()])}>
          {t("req.addItem")}
        </Button>
      </div>

      <div>
        <Label htmlFor="notes">{t("req.notes")}</Label>
        <Textarea id="notes" name="notes" rows={2} placeholder={t("req.notesPlaceholder")} />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? t("req.submitting") : t("req.submit")}
      </Button>
      <p className="text-center text-xs text-ink-400">{t("req.offline")}</p>
    </form>
  );
}
