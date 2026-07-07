"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { submitOrQueue } from "@/lib/outbox";
import { Button, Card, CardBody, Input } from "@/components/ui";
import { PhotoInput } from "@/components/photo-input";

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
export function DeliveryChecklistForm({ poId, items }: { poId: string; items: PoItem[] }) {
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [queuedMsg, setQueuedMsg] = useState("");

  function update(i: number, patch: Partial<CheckRow>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  const hasDiscrepancy = rows.some((r) => !r.ok || Number(r.receivedQty) < r.orderedQty);

  async function submit() {
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
      setError(result.error ?? "Submission failed");
      return;
    }
    if (result.queued) {
      setQueuedMsg("No signal — delivery form saved on this device and will sync automatically.");
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
          <p className="font-semibold text-amber-700">Saved to outbox</p>
          <p className="text-sm text-ink-600">{queuedMsg}</p>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
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
                  Ordered: {r.orderedQty} {r.unit}
                </div>
              </div>
              <label className="flex min-h-[44px] items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={r.ok}
                  onChange={(e) => update(i, { ok: e.target.checked })}
                  className="h-6 w-6 rounded accent-emerald-600"
                />
                Spec OK
              </label>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div>
                <span className="mb-1 block text-xs text-ink-500">Received qty</span>
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
                <span className="mb-1 block text-xs text-ink-500">Remarks</span>
                <Input
                  placeholder="short / damaged / wrong spec…"
                  value={r.remarks}
                  onChange={(e) => update(i, { remarks: e.target.value })}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      <PhotoInput label="Photos (delivery, damage, receipts)" onChange={setPhotos} />

      {hasDiscrepancy && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
          ⚠ Discrepancies detected — PM and Purchasing will be notified automatically for
          supplier follow-up.
        </p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button onClick={submit} disabled={busy} className="w-full">
        {busy ? "Submitting…" : "Submit delivery form"}
      </Button>
      <p className="text-center text-xs text-ink-400">
        Works offline. GPS + time are recorded for verification.
      </p>
    </div>
  );
}
