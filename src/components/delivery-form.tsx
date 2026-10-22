"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { submitOrQueue } from "@/lib/outbox";
import { Button, Card, CardBody, Input, Label, Select } from "@/components/ui";
import { missingNames } from "@/lib/delivery-confirm";
import { PhotoInput } from "@/components/photo-input";
import { useT } from "@/components/lang-provider";

interface PoItem {
  name: string;
  qty: number;
  unit: string;
}

interface CheckRow {
  item: string;
  orderedQty: number;
  unit: string;
  receivedQty: string;
  ok: boolean;
  remarks: string;
}

function getGps(): Promise<string> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve("");
    const timer = setTimeout(() => resolve(""), 4000);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        resolve(`${pos.coords.latitude.toFixed(6)},${pos.coords.longitude.toFixed(6)}`);
      },
      () => {
        clearTimeout(timer);
        resolve("");
      },
      { timeout: 3500, maximumAge: 60000 }
    );
  });
}

/**
 * On-site delivery checklist against the PO (Spec 6.3) — check off each line,
 * flag shortages/damage with photos. Offline-capable; GPS + device timestamp
 * are captured for verification.
 */
export function DeliveryChecklistForm({ poId, items, receivers, meId }: { poId: string; items: PoItem[]; receivers: { id: string; name: string; position: string | null }[]; meId: string }) {
  const t = useT();
  const router = useRouter();
  const [rows, setRows] = useState<CheckRow[]>(
    items.map((i) => ({
      item: i.name,
      orderedQty: i.qty,
      unit: i.unit,
      receivedQty: String(i.qty),
      ok: true,
      remarks: "",
    }))
  );
  const [photos, setPhotos] = useState<string[]>([]);
  const [driverName, setDriverName] = useState("");
  const NOT_LISTED = "__other";
  const [receiverChoice, setReceiverChoice] = useState(""); // a staff member's id, NOT_LISTED, or "" (not chosen yet)
  const [recipientName, setRecipientName] = useState(""); // typed name when the receiver is not in the app
  const receiverId = receiverChoice && receiverChoice !== NOT_LISTED ? receiverChoice : "";
  const missing = missingNames({ driverName, receiverId, recipientName: receiverChoice === NOT_LISTED ? recipientName : "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [queuedMsg, setQueuedMsg] = useState("");

  function update(i: number, patch: Partial<CheckRow>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  const hasDiscrepancy = rows.some((r) => !r.ok || Number(r.receivedQty) < r.orderedQty);

  async function submit() {
    if (missing) return setError(missing);
    setBusy(true);
    setError("");
    const gps = await getGps();
    const result = await submitOrQueue({
      url: "/api/deliveries",
      label: "Delivery checklist",
      body: {
        poId,
        gps,
        photos,
        driverName: driverName.trim(),
        receiverId,
        recipientName: receiverChoice === NOT_LISTED ? recipientName.trim() : "",
        checklist: rows.map((r) => ({
          item: r.item,
          orderedQty: r.orderedQty,
          receivedQty: Number(r.receivedQty) || 0,
          ok: r.ok,
          remarks: r.remarks,
        })),
      },
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? t("del.failed"));
      return;
    }
    if (result.queued) {
      setQueuedMsg(t("del.queued"));
      return;
    }
    router.push("/deliveries");
    router.refresh();
  }

  if (queuedMsg) {
    return (
      <Card>
        <CardBody className="space-y-3 text-center">
          <p className="text-3xl">📥</p>
          <p className="font-semibold text-amber-700">{t("form.savedToOutbox")}</p>
          <p className="text-sm text-ink-600">{queuedMsg}</p>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="driverName">{t("del.driver")} *</Label>
          <Input
            id="driverName"
            required
            placeholder={t("del.driverPh")}
            value={driverName}
            onChange={(e) => setDriverName(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="receiverChoice">{t("del.receivedBy")} *</Label>
          <Select id="receiverChoice" required value={receiverChoice} onChange={(e) => setReceiverChoice(e.target.value)}>
            <option value="" disabled>
              Choose who is receiving it…
            </option>
            {receivers.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {r.id === meId ? " (me)" : r.position ? ` — ${r.position}` : ""}
              </option>
            ))}
            <option value={NOT_LISTED}>Someone not in the app (type the name)</option>
          </Select>
          {receiverChoice === NOT_LISTED && (
            <Input className="mt-2" aria-label="Name of the person receiving" placeholder={t("del.receivedByPh")} value={recipientName} onChange={(e) => setRecipientName(e.target.value)} />
          )}
        </div>
        <p className="text-xs text-ink-500 sm:col-span-2">
          {receiverId === meId
            ? "You are the one receiving it, so it is fully verified as soon as you send it."
            : "The delivery is fully verified only when the person receiving it confirms in the app. Until then the PO stays as it is."}
        </p>
      </div>

      <div className="space-y-3">
        {rows.map((r, i) => (
          <div
            key={i}
            className={`rounded-lg border p-3 ${r.ok && Number(r.receivedQty) >= r.orderedQty ? "border-ink-100" : "border-amber-300 bg-amber-50"}`}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-medium text-ink-900">{r.item}</div>
                <div className="text-xs text-ink-500">
                  {t("del.ordered")}: {r.orderedQty} {r.unit}
                </div>
              </div>
              <label className="flex min-h-[44px] items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={r.ok}
                  onChange={(e) => update(i, { ok: e.target.checked })}
                  className="h-6 w-6 rounded accent-emerald-600"
                />
                {t("del.specOk")}
              </label>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div>
                <span className="mb-1 block text-xs text-ink-500">{t("del.receivedQty")}</span>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={r.receivedQty}
                  onChange={(e) => update(i, { receivedQty: e.target.value })}
                />
              </div>
              <div>
                <span className="mb-1 block text-xs text-ink-500">{t("del.remarks")}</span>
                <Input
                  placeholder={t("del.remarksPh")}
                  value={r.remarks}
                  onChange={(e) => update(i, { remarks: e.target.value })}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      <PhotoInput label={t("del.photos")} onChange={setPhotos} />

      {hasDiscrepancy && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
          {t("del.discrepancy")}
        </p>
      )}
      {missing && <p className="text-sm font-medium text-amber-700">{missing} before you can verify this delivery.</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button onClick={submit} disabled={busy || !!missing} className="w-full">
        {busy ? t("del.submitting") : t("del.submit")}
      </Button>
      <p className="text-center text-xs text-ink-400">{t("del.footer")}</p>
    </div>
  );
}
