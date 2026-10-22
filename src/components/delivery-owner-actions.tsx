"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/modal";
import { discrepancyLines, planAdjustment, type ChecklistRow, type PoLine } from "@/lib/delivery-adjust";

const peso = (n: number) => `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const smallBtn = "text-xs font-medium hover:underline disabled:opacity-50";
const field = "min-h-[40px] w-full rounded-lg border border-ink-200 bg-ink-50 px-3 text-sm text-ink-900 focus:border-[#8a1a28] focus:outline-none";
const primary = "min-h-[40px] rounded-lg bg-[#8a1a28] px-4 text-sm font-semibold text-white hover:bg-[#741522] disabled:opacity-50";
const secondary = "min-h-[40px] rounded-lg border border-ink-200 px-4 text-sm font-medium text-ink-700 hover:bg-ink-100";

async function patch(id: string, body: Record<string, unknown>): Promise<string | null> {
  const res = await fetch(`/api/deliveries/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (res.ok) return null;
  return ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Something went wrong";
}

export interface OwnerDelivery {
  id: string;
  poNumber: string;
  driverName: string | null;
  recipientName: string | null;
  checklist: ChecklistRow[];
  hasDiscrepancy: boolean;
  accepted: boolean;
  poItems: PoLine[];
}

/**
 * Owner only, on each delivery form: fix what was recorded, accept a delivery that does not match the PO as final (with a
 * reason) so the PO and requisition follow what was delivered, or take that acceptance back.
 */
export function OwnerDeliveryActions({ d }: { d: OwnerDelivery }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      <EditDelivery d={d} />
      {d.hasDiscrepancy && !d.accepted && <AcceptDelivery d={d} />}
      {d.accepted && <UndoAccept d={d} />}
    </span>
  );
}

function EditDelivery({ d }: { d: OwnerDelivery }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(d.checklist.map((c) => ({ ...c, receivedQty: String(c.receivedQty), remarks: c.remarks ?? "" })));
  const [driver, setDriver] = useState(d.driverName ?? "");
  const [recipient, setRecipient] = useState(d.recipientName ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const asChecklist: ChecklistRow[] = rows.map((r) => ({ item: r.item, orderedQty: r.orderedQty, receivedQty: Number(r.receivedQty) || 0, ok: r.ok, remarks: r.remarks }));
  const nowShort = discrepancyLines(asChecklist);
  const update = (i: number, p: Partial<(typeof rows)[number]>) => setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...p } : r)));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (rows.some((r) => !(Number(r.receivedQty) >= 0) || r.receivedQty.trim() === "")) return setError("Every item needs a quantity received (0 if none arrived)");
    setBusy(true);
    setError("");
    const err = await patch(d.id, {
      action: "edit",
      checklist: asChecklist.map((c) => ({ item: c.item, receivedQty: c.receivedQty, ok: c.ok, remarks: c.remarks ?? "" })),
      driverName: driver,
      recipientName: recipient,
      reason: reason.trim(),
    });
    setBusy(false);
    if (err) return setError(err);
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`${smallBtn} text-brand-600`} aria-label={`Edit delivery ${d.poNumber}`}>
        ✎ Edit
      </button>
      {open && (
        <Modal title={`Edit delivery — ${d.poNumber}`} onClose={() => setOpen(false)} wide>
          <form onSubmit={save} className="space-y-4">
            {d.accepted && <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">You accepted this delivery before. Saving a change takes that acceptance back — the PO and requisition return to what they were — and you can accept again afterwards.</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-medium text-ink-600">
                Driver
                <input value={driver} onChange={(e) => setDriver(e.target.value)} className={`${field} mt-1`} />
              </label>
              <label className="text-xs font-medium text-ink-600">
                Received by
                <input value={recipient} onChange={(e) => setRecipient(e.target.value)} className={`${field} mt-1`} />
              </label>
            </div>

            <div className="space-y-2">
              {rows.map((r, i) => {
                const short = !r.ok || (Number(r.receivedQty) || 0) < r.orderedQty;
                return (
                  <div key={r.item} className={`rounded-lg border p-3 ${short ? "border-amber-300 bg-amber-50 dark:bg-amber-900/20" : "border-ink-100"}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="font-medium text-ink-900">{r.item}</div>
                        <div className="text-xs text-ink-500">Ordered: {r.orderedQty}</div>
                      </div>
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={r.ok} onChange={(e) => update(i, { ok: e.target.checked })} className="h-5 w-5 accent-emerald-600" />
                        In good order
                      </label>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <label className="text-xs text-ink-500">
                        Quantity actually received
                        <input type="number" min="0" step="0.01" inputMode="decimal" value={r.receivedQty} onChange={(e) => update(i, { receivedQty: e.target.value })} className={`${field} mt-1`} />
                      </label>
                      <label className="text-xs text-ink-500">
                        Remarks
                        <input value={r.remarks} onChange={(e) => update(i, { remarks: e.target.value })} className={`${field} mt-1`} />
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>

            <p className={`rounded-md px-3 py-2 text-sm ${nowShort.length ? "bg-amber-50 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200" : "bg-emerald-50 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200"}`}>
              {nowShort.length ? `With these numbers the delivery does not tally with the PO (${nowShort.length} item${nowShort.length === 1 ? "" : "s"}). It will show as partially delivered until you accept it or the rest arrives.` : "With these numbers everything tallies with the PO — the delivery will show as complete."}
            </p>

            <label className="block text-xs font-medium text-ink-600">
              Why is this being corrected?
              <input value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} placeholder="e.g., driver pressed submit without counting — only 2 of 5 came" className={`${field} mt-1`} />
            </label>
            {error && <p className="text-sm text-red-700 dark:text-red-300">{error}</p>}
            <div className="flex gap-2">
              <button type="submit" disabled={busy || reason.trim().length < 3} className={primary}>
                {busy ? "Saving…" : "Save correction"}
              </button>
              <button type="button" onClick={() => setOpen(false)} className={secondary}>
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

function AcceptDelivery({ d }: { d: OwnerDelivery }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const plan = planAdjustment(d.poItems, d.checklist);
  const short = discrepancyLines(d.checklist);

  async function accept() {
    setBusy(true);
    setError("");
    const err = await patch(d.id, { action: "accept", reason: reason.trim(), expectedTotalAfter: plan.totalAfter });
    setBusy(false);
    if (err) return setError(err);
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`${smallBtn} text-emerald-700 dark:text-emerald-300`} aria-label={`Accept delivery ${d.poNumber} as complete`}>
        ✓ Accept as complete
      </button>
      {open && (
        <Modal title={`Accept ${d.poNumber} as complete`} onClose={() => setOpen(false)} wide>
          <div className="space-y-4">
            <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
              <div className="font-semibold">What did not tally</div>
              <ul className="mt-1 list-disc pl-5 text-xs">
                {short.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>

            {plan.unchanged ? (
              <p className="text-sm text-ink-700">The PO quantities already match what was delivered, so nothing on the PO or requisition changes — this only marks the delivery as complete.</p>
            ) : (
              <div>
                <div className="mb-1 text-sm font-semibold text-ink-900">The PO and requisition will be changed to what was delivered</div>
                <div className="overflow-x-auto rounded-lg border border-ink-200">
                  <table className="w-full min-w-[420px] text-left text-sm">
                    <thead className="bg-ink-100 text-xs uppercase tracking-wide text-ink-600">
                      <tr>
                        <th className="px-3 py-2">Item</th>
                        <th className="px-3 py-2 text-right">PO qty</th>
                        <th className="px-3 py-2 text-right">Delivered</th>
                        <th className="px-3 py-2 text-right">Cost change</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.lines.map((l) => (
                        <tr key={l.item} className="border-t border-ink-100">
                          <td className="px-3 py-2 font-medium text-ink-900">{l.item}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {l.from} {l.unit}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums font-semibold">
                            {l.to} {l.unit}
                          </td>
                          <td className={`px-3 py-2 text-right tabular-nums ${l.costChange < 0 ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300"}`}>
                            {l.costChange < 0 ? "−" : "+"}
                            {peso(Math.abs(l.costChange))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 rounded-md bg-ink-100 px-3 py-2 text-sm">
                  Cost committed on this PO (and so on the project): <b className="tabular-nums">{peso(plan.totalBefore)}</b> → <b className="tabular-nums">{peso(plan.totalAfter)}</b>
                </p>
                <p className="mt-1 text-xs text-ink-500">The requisition&apos;s quantities and estimated cost change the same way. You can undo this later; it is recorded with your reason.</p>
              </div>
            )}

            <p className="text-xs font-medium text-ink-700">Accept only if nothing more is coming for this PO — afterwards the PO and the requisition show as Delivered.</p>
            <label className="block text-xs font-medium text-ink-600">
              Your reason for accepting it as complete
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g., supplier confirmed the balance is cancelled; 2 bags were enough" className={`${field} mt-1`} />
            </label>
            {error && <p className="text-sm text-red-700 dark:text-red-300">{error}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={accept} disabled={busy || reason.trim().length < 5} className={primary}>
                {busy ? "Saving…" : plan.unchanged ? "Accept as complete" : "Accept and adjust the PO"}
              </button>
              <button type="button" onClick={() => setOpen(false)} className={secondary}>
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

function UndoAccept({ d }: { d: OwnerDelivery }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function undo() {
    const reason = window.prompt(`Take back your acceptance of ${d.poNumber}? The PO and requisition go back to what they were before.\n\nWhy?`);
    if (!reason || reason.trim().length < 3) return;
    setBusy(true);
    const err = await patch(d.id, { action: "undo_accept", reason: reason.trim() });
    setBusy(false);
    if (err) window.alert(err);
    else router.refresh();
  }

  return (
    <button type="button" onClick={undo} disabled={busy} className={`${smallBtn} text-amber-700 dark:text-amber-300`}>
      {busy ? "…" : "↩ Undo acceptance"}
    </button>
  );
}
