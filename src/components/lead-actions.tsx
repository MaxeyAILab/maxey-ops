"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label, Select, Textarea } from "@/components/ui";
import { php } from "@/lib/format";

const STATUSES = [
  "NEW",
  "UNDER_REVIEW",
  "ESTIMATE_IN_PROGRESS",
  "QUOTATION_SENT",
  "WON",
  "LOST",
] as const;

export function LeadStatusSelect({ leadId, current }: { leadId: string; current: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function change(status: string) {
    setBusy(true);
    await fetch(`/api/leads/${leadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setBusy(false);
    router.refresh();
  }

  return (
    <Select
      value={current}
      disabled={busy}
      onChange={(e) => change(e.target.value)}
      className="w-56"
    >
      {STATUSES.map((s) => (
        <option key={s} value={s}>
          {s.toLowerCase().split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ")}
        </option>
      ))}
    </Select>
  );
}

export function ConvertLeadForm({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const fd = new FormData(e.currentTarget);
    const res = await fetch(`/api/leads/${leadId}/convert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectName: fd.get("projectName"),
        contractValue: fd.get("contractValue"),
        address: fd.get("address") || undefined,
        downpaymentPct: fd.get("downpaymentPct"),
        retentionPct: fd.get("retentionPct"),
      }),
    });
    setBusy(false);
    if (res.ok) {
      const project = await res.json();
      router.push(`/projects/${project.id}`);
    } else {
      setError((await res.json()).error ?? "Failed to convert lead");
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div>
        <Label htmlFor="projectName">Project name *</Label>
        <Input id="projectName" name="projectName" required />
      </div>
      <div>
        <Label htmlFor="address">Project address</Label>
        <Input id="address" name="address" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <Label htmlFor="contractValue">Contract value (PHP) *</Label>
          <Input id="contractValue" name="contractValue" type="number" min="0" step="0.01" required />
        </div>
        <div>
          <Label htmlFor="downpaymentPct">Downpayment %</Label>
          <Input id="downpaymentPct" name="downpaymentPct" type="number" defaultValue={30} min="0" max="100" />
        </div>
        <div>
          <Label htmlFor="retentionPct">Retention %</Label>
          <Input id="retentionPct" name="retentionPct" type="number" defaultValue={10} min="0" max="100" />
        </div>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" disabled={busy} variant="success" className="w-full">
        {busy ? "Converting…" : "Convert to Project"}
      </Button>
    </form>
  );
}

interface LineItem {
  category: string;
  description: string;
  qty: string;
  unit: string;
  unitPrice: string;
}

const emptyItem = (): LineItem => ({
  category: "MATERIAL",
  description: "",
  qty: "1",
  unit: "lot",
  unitPrice: "0",
});

export function QuotationBuilder({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [items, setItems] = useState<LineItem[]>([emptyItem()]);
  const [markupPct, setMarkupPct] = useState("15");
  const [vatPct, setVatPct] = useState("12");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const subtotal = items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.unitPrice) || 0), 0);
  const markup = subtotal * ((Number(markupPct) || 0) / 100);
  const vat = (subtotal + markup) * ((Number(vatPct) || 0) / 100);
  const total = subtotal + markup + vat;

  function update(i: number, patch: Partial<LineItem>) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }

  async function save() {
    setBusy(true);
    setError("");
    const res = await fetch("/api/quotations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        leadId,
        markupPct,
        vatPct,
        lineItems: items.filter((i) => i.description.trim()),
      }),
    });
    setBusy(false);
    if (res.ok) {
      const q = await res.json();
      router.push(`/quotations/${q.id}`);
    } else {
      setError((await res.json()).error ?? "Failed to save quotation");
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {items.map((it, i) => (
          <div key={i} className="grid grid-cols-12 gap-2">
            <Select
              value={it.category}
              onChange={(e) => update(i, { category: e.target.value })}
              className="col-span-3 sm:col-span-2"
            >
              <option value="MATERIAL">Material</option>
              <option value="LABOR">Labor</option>
              <option value="EQUIPMENT">Equipment</option>
              <option value="OTHER">Other</option>
            </Select>
            <Input
              placeholder="Description"
              value={it.description}
              onChange={(e) => update(i, { description: e.target.value })}
              className="col-span-9 sm:col-span-4"
            />
            <Input
              type="number"
              min="0"
              step="0.01"
              placeholder="Qty"
              value={it.qty}
              onChange={(e) => update(i, { qty: e.target.value })}
              className="col-span-3 sm:col-span-2"
            />
            <Input
              placeholder="Unit"
              value={it.unit}
              onChange={(e) => update(i, { unit: e.target.value })}
              className="col-span-3 sm:col-span-1"
            />
            <Input
              type="number"
              min="0"
              step="0.01"
              placeholder="Unit price"
              value={it.unitPrice}
              onChange={(e) => update(i, { unitPrice: e.target.value })}
              className="col-span-4 sm:col-span-2"
            />
            <button
              type="button"
              onClick={() => setItems((prev) => prev.filter((_, idx) => idx !== i))}
              className="col-span-2 sm:col-span-1 rounded-lg text-sm text-red-500 hover:bg-red-50"
              aria-label="Remove line"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <Button type="button" variant="secondary" onClick={() => setItems((p) => [...p, emptyItem()])}>
        + Add line item
      </Button>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <Label>Markup %</Label>
          <Input type="number" min="0" max="100" value={markupPct} onChange={(e) => setMarkupPct(e.target.value)} />
        </div>
        <div>
          <Label>VAT %</Label>
          <Input type="number" min="0" max="100" value={vatPct} onChange={(e) => setVatPct(e.target.value)} />
        </div>
        <div className="col-span-2 flex items-end justify-end text-right">
          <div>
            <div className="text-xs text-ink-500">
              Subtotal {php(subtotal)} · Markup {php(markup)} · VAT {php(vat)}
            </div>
            <div className="text-lg font-bold text-ink-900">Total {php(total)}</div>
          </div>
        </div>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="button" onClick={save} disabled={busy || subtotal === 0} className="w-full">
        {busy ? "Saving…" : "Save quotation"}
      </Button>
    </div>
  );
}

export function QuotationStatusButton({
  quotationId,
  status,
}: {
  quotationId: string;
  status: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function set(next: string) {
    setBusy(true);
    await fetch(`/api/quotations/${quotationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    setBusy(false);
    router.refresh();
  }

  if (status === "DRAFT") {
    return (
      <Button variant="secondary" disabled={busy} onClick={() => set("SENT")} className="no-print">
        Mark as sent to client
      </Button>
    );
  }
  if (status === "SENT") {
    return (
      <div className="no-print flex gap-2">
        <Button variant="success" disabled={busy} onClick={() => set("ACCEPTED")}>
          Client accepted
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => set("REJECTED")}>
          Client rejected
        </Button>
      </div>
    );
  }
  return null;
}
