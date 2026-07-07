"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { submitOrQueue } from "@/lib/outbox";
import { Button, Card, CardBody, Input, Label, Select, Textarea } from "@/components/ui";

interface ProjectOption {
  id: string;
  name: string;
}

interface Item {
  name: string;
  spec: string;
  qty: string;
  unit: string;
}

const emptyItem = (): Item => ({ name: "", spec: "", qty: "1", unit: "pcs" });

/**
 * Field requisition form — works fully offline (Spec §4/6.2). When there is
 * no signal it queues to the IndexedDB outbox with the device timestamp and
 * syncs automatically when connectivity returns.
 */
export function RequisitionForm({ projects }: { projects: ProjectOption[] }) {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([emptyItem()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [queuedMsg, setQueuedMsg] = useState("");

  function update(i: number, patch: Partial<Item>) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const fd = new FormData(e.currentTarget);
    const validItems = items.filter((i) => i.name.trim());
    if (validItems.length === 0) {
      setError("Add at least one item.");
      setBusy(false);
      return;
    }

    const result = await submitOrQueue({
      url: "/api/requisitions",
      label: `Requisition: ${validItems.length} item(s)`,
      body: {
        projectId: fd.get("projectId"),
        urgency: fd.get("urgency"),
        neededBy: fd.get("neededBy") || undefined,
        notes: fd.get("notes"),
        items: validItems,
      },
    });
    setBusy(false);

    if (!result.ok) {
      setError(result.error ?? "Submission failed");
      return;
    }
    if (result.queued) {
      setQueuedMsg(
        "No signal — requisition saved on this device and will sync automatically when you're back online."
      );
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
          <p className="font-semibold text-amber-700">Saved to outbox</p>
          <p className="text-sm text-ink-600">{queuedMsg}</p>
          <Button variant="secondary" onClick={() => { setQueuedMsg(""); setItems([emptyItem()]); }}>
            Submit another
          </Button>
        </CardBody>
      </Card>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="projectId">Project *</Label>
          <Select id="projectId" name="projectId" required>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="urgency">Urgency</Label>
          <Select id="urgency" name="urgency" defaultValue="NORMAL">
            <option value="LOW">Low</option>
            <option value="NORMAL">Normal</option>
            <option value="HIGH">High</option>
            <option value="CRITICAL">Critical</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="neededBy">Needed by</Label>
          <Input id="neededBy" name="neededBy" type="date" />
        </div>
      </div>

      <div className="space-y-3">
        <Label>Items *</Label>
        {items.map((it, i) => (
          <div key={i} className="space-y-2 rounded-lg border border-ink-100 p-3">
            <div className="grid grid-cols-12 gap-2">
              <Input
                placeholder="Material / item name"
                value={it.name}
                onChange={(e) => update(i, { name: e.target.value })}
                className="col-span-12 sm:col-span-6"
              />
              <Input
                type="number"
                min="0.01"
                step="0.01"
                inputMode="decimal"
                placeholder="Qty"
                value={it.qty}
                onChange={(e) => update(i, { qty: e.target.value })}
                className="col-span-4 sm:col-span-2"
              />
              <Input
                placeholder="Unit (pcs, bags…)"
                value={it.unit}
                onChange={(e) => update(i, { unit: e.target.value })}
                className="col-span-5 sm:col-span-3"
              />
              <button
                type="button"
                onClick={() => setItems((prev) => prev.filter((_, idx) => idx !== i))}
                className="col-span-3 sm:col-span-1 min-h-[44px] rounded-lg text-red-500 hover:bg-red-50"
                aria-label="Remove item"
              >
                ✕
              </button>
            </div>
            <Input
              placeholder="Specification / brand / size (optional)"
              value={it.spec}
              onChange={(e) => update(i, { spec: e.target.value })}
            />
          </div>
        ))}
        <Button type="button" variant="secondary" onClick={() => setItems((p) => [...p, emptyItem()])}>
          + Add item
        </Button>
      </div>

      <div>
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" name="notes" rows={2} placeholder="Purpose, delivery instructions…" />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? "Submitting…" : "Submit requisition"}
      </Button>
      <p className="text-center text-xs text-ink-400">
        Works offline — if you have no signal, it will sync automatically later.
      </p>
    </form>
  );
}
