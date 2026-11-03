"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label } from "@/components/ui";

const peso = (n: number) => `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * The project cost (contract value). The Owner can revise it while the project is still in Site Survey or Mobilization — with a
 * reason, which goes in the audit log. Once construction has started it is final: this shows a notice instead, and additional work
 * goes through a client request or a change order the client approves.
 */
export function ContractValueEditor({
  projectId,
  current,
  lock,
  canEdit,
  approvedChangeOrders,
}: {
  projectId: string;
  current: number;
  lock: { locked: boolean; message: string | null };
  canEdit: boolean;
  approvedChangeOrders: { count: number; total: number };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(String(current));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (lock.locked) {
    return (
      <p className="rounded-lg border border-ink-100 bg-ink-50 px-3 py-2 text-xs text-ink-600 dark:bg-transparent">
        <span className="font-semibold text-ink-800">Contract value is final.</span> {lock.message}
      </p>
    );
  }
  if (!canEdit) return null;

  async function save() {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/projects/${projectId}/contract-value`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contractValue: Number(value), reason }),
    });
    setBusy(false);
    if (!res.ok) return setError(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Could not save");
    setOpen(false);
    setReason("");
    router.refresh();
  }

  return (
    <div className="rounded-lg border border-ink-100 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-ink-600">
          The contract value can still be revised by the Owner until construction starts. Once the project is On-going Construction it is final.
        </span>
        <button type="button" onClick={() => setOpen((o) => !o)} className="text-xs font-medium text-brand-600 hover:underline">
          {open ? "Close" : "Edit contract value"}
        </button>
      </div>
      {open && (
        <div className="mt-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-[14rem_1fr]">
            <div>
              <Label htmlFor="cv-value">New contract value (₱)</Label>
              <Input id="cv-value" type="number" min="0" step="0.01" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="cv-reason">Why is it being revised?</Label>
              <Input id="cv-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. revised scope agreed with the client before mobilization" />
            </div>
          </div>
          <p className="text-xs text-ink-500">
            Now {peso(current)}.
            {approvedChangeOrders.count > 0 && ` This figure already includes ${approvedChangeOrders.count} approved change order${approvedChangeOrders.count === 1 ? "" : "s"} (${peso(approvedChangeOrders.total)}).`}{" "}
            Payment terms were set from the old value — check them after changing it. The change is recorded with the old value, the new value and your reason.
          </p>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" className="text-xs" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              className="text-xs"
              disabled={busy || reason.trim().length < 3 || !(Number(value) >= 0) || value.trim() === "" || Number(value) === current}
              onClick={() => {
                if (window.confirm(`Change the contract value from ${peso(current)} to ${peso(Number(value))}?`)) save();
              }}
            >
              {busy ? "Saving…" : "Save contract value"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
