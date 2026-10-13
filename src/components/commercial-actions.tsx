"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label, Textarea } from "@/components/ui";

async function send(url: string, method: string, body: unknown) {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (res.ok) return { ok: true as const };
  return { ok: false as const, error: ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Something went wrong" };
}

const numOrNull = (v: FormDataEntryValue | null) => (v === null || v === "" ? null : Number(v));
const strOrNull = (v: FormDataEntryValue | null) => (v ? String(v) : null);
const link = "text-xs font-medium text-brand-600 hover:underline";

// ---------- potential change (internal; not sent to the client) ----------

export function PotentialChangeForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const form = e.currentTarget;
    const fd = new FormData(form);
    const r = await send("/api/change-orders", "POST", {
      projectId,
      asPotential: true,
      title: fd.get("title"),
      description: fd.get("description"),
      reason: strOrNull(fd.get("reason")),
      estimatedCost: numOrNull(fd.get("estimatedCost")),
      timeImpactDays: numOrNull(fd.get("timeImpactDays")) ?? 0,
    });
    setBusy(false);
    if (r.ok) {
      form.reset();
      router.refresh();
    } else setError(r.error);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <p className="text-xs text-ink-600">
        A potential change is tracked internally only. The client doesn’t see it, and it isn’t part of the contract value, until you price it and send it.
      </p>
      <div>
        <Label htmlFor="pc-title">Title *</Label>
        <Input id="pc-title" name="title" required maxLength={200} placeholder="e.g., Client asked to relocate the gate" />
      </div>
      <div>
        <Label htmlFor="pc-desc">What changed *</Label>
        <Textarea id="pc-desc" name="description" rows={3} required maxLength={5000} />
      </div>
      <div>
        <Label htmlFor="pc-reason">Why / supporting note</Label>
        <Input id="pc-reason" name="reason" maxLength={2000} placeholder="e.g., Site instruction SI-014, RFI-003" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="pc-cost">Estimated cost (PHP, optional)</Label>
          <Input id="pc-cost" name="estimatedCost" type="number" min="0" step="0.01" />
        </div>
        <div>
          <Label htmlFor="pc-days">Time impact (days)</Label>
          <Input id="pc-days" name="timeImpactDays" type="number" min="0" step="1" defaultValue={0} />
        </div>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? "Saving…" : "Log potential change"}
      </Button>
    </form>
  );
}

export interface ChangeLifecycleProps {
  id: string;
  status: "POTENTIAL" | "PENDING_CLIENT" | "APPROVED" | "REJECTED" | "WITHDRAWN";
  title: string;
  description: string;
  estimatedCost: number | null;
  timeImpactDays: number;
  reason: string | null;
}

/** Owner/PM: send a potential change to the client, edit it, or withdraw a change that is still open. */
export function ChangeLifecycleControls({ co }: { co: ChangeLifecycleProps }) {
  const router = useRouter();
  const [mode, setMode] = useState<null | "send" | "edit" | "withdraw">(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(body: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    const r = await send(`/api/change-orders/${co.id}`, "PATCH", body);
    setBusy(false);
    if (r.ok) {
      setMode(null);
      router.refresh();
    } else setError(r.error);
  }

  if (co.status !== "POTENTIAL" && co.status !== "PENDING_CLIENT") return null;

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-3">
        {co.status === "POTENTIAL" && (
          <>
            <button type="button" className="min-h-[32px] rounded-sm bg-brand-500 px-3 text-xs font-semibold text-white hover:bg-brand-600" onClick={() => setMode(mode === "send" ? null : "send")}>
              Price &amp; send to client
            </button>
            <button type="button" className={link} onClick={() => setMode(mode === "edit" ? null : "edit")}>
              Edit
            </button>
          </>
        )}
        <button type="button" className="text-xs font-medium text-red-600 hover:underline" onClick={() => setMode(mode === "withdraw" ? null : "withdraw")}>
          Withdraw
        </button>
      </div>

      {mode === "send" && (
        <form
          className="mt-2 space-y-3 rounded-sm border border-brand-200 bg-brand-50 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            run({ action: "send", costImpact: numOrNull(fd.get("costImpact")), timeImpactDays: numOrNull(fd.get("timeImpactDays")), title: fd.get("title"), description: fd.get("description") });
          }}
        >
          <p className="text-xs text-ink-700">The client gets a change order to approve or reject. The contract value only changes if they approve it.</p>
          <div>
            <Label htmlFor={`st-${co.id}`}>Title</Label>
            <Input id={`st-${co.id}`} name="title" defaultValue={co.title} required maxLength={200} />
          </div>
          <div>
            <Label htmlFor={`sd-${co.id}`}>Scope shown to the client</Label>
            <Textarea id={`sd-${co.id}`} name="description" rows={3} defaultValue={co.description} required maxLength={5000} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor={`sc-${co.id}`}>Cost impact (PHP) *</Label>
              <Input id={`sc-${co.id}`} name="costImpact" type="number" min="0" step="0.01" required defaultValue={co.estimatedCost ?? ""} />
            </div>
            <div>
              <Label htmlFor={`sy-${co.id}`}>Time impact (days) *</Label>
              <Input id={`sy-${co.id}`} name="timeImpactDays" type="number" min="0" step="1" required defaultValue={co.timeImpactDays} />
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy} className="text-xs">
              {busy ? "Sending…" : "Send to client"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setMode(null)} className="text-xs">
              Cancel
            </Button>
          </div>
        </form>
      )}

      {mode === "edit" && (
        <form
          className="mt-2 space-y-3 rounded-sm border border-ink-200 bg-ink-100/60 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            run({
              action: "update_potential",
              title: fd.get("title"),
              description: fd.get("description"),
              reason: strOrNull(fd.get("reason")),
              estimatedCost: numOrNull(fd.get("estimatedCost")),
              timeImpactDays: numOrNull(fd.get("timeImpactDays")) ?? 0,
            });
          }}
        >
          <div>
            <Label htmlFor={`et-${co.id}`}>Title</Label>
            <Input id={`et-${co.id}`} name="title" defaultValue={co.title} required maxLength={200} />
          </div>
          <div>
            <Label htmlFor={`ed-${co.id}`}>What changed</Label>
            <Textarea id={`ed-${co.id}`} name="description" rows={3} defaultValue={co.description} required maxLength={5000} />
          </div>
          <div>
            <Label htmlFor={`er-${co.id}`}>Why / supporting note</Label>
            <Input id={`er-${co.id}`} name="reason" defaultValue={co.reason ?? ""} maxLength={2000} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor={`ec-${co.id}`}>Estimated cost (PHP)</Label>
              <Input id={`ec-${co.id}`} name="estimatedCost" type="number" min="0" step="0.01" defaultValue={co.estimatedCost ?? ""} />
            </div>
            <div>
              <Label htmlFor={`ey-${co.id}`}>Time impact (days)</Label>
              <Input id={`ey-${co.id}`} name="timeImpactDays" type="number" min="0" step="1" defaultValue={co.timeImpactDays} />
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy} className="text-xs">
              {busy ? "Saving…" : "Save"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setMode(null)} className="text-xs">
              Cancel
            </Button>
          </div>
        </form>
      )}

      {mode === "withdraw" && (
        <form
          className="mt-2 space-y-3 rounded-sm border border-red-300 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/30"
          onSubmit={(e) => {
            e.preventDefault();
            run({ action: "withdraw", reason: new FormData(e.currentTarget).get("reason") });
          }}
        >
          <p className="text-xs text-ink-700">
            {co.status === "PENDING_CLIENT"
              ? "This pulls it back from the client’s portal. The record is kept."
              : "The record is kept as withdrawn."}
          </p>
          <div>
            <Label htmlFor={`wr-${co.id}`}>Reason *</Label>
            <Input id={`wr-${co.id}`} name="reason" required minLength={5} maxLength={1000} />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy} className="text-xs">
              {busy ? "Saving…" : "Withdraw"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setMode(null)} className="text-xs">
              Cancel
            </Button>
          </div>
        </form>
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

// ---------- billing details on a payment term ----------

export interface BillingDetailsProps {
  id: string;
  type: string;
  invoiceNo: string | null;
  invoicedAt: string | null;
  certifiedAt: string | null;
  dueDate: string | null;
  retentionReleaseDate: string | null;
}

export function BillingDetailsButton({ term }: { term: BillingDetailsProps }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const fd = new FormData(e.currentTarget);
    const r = await send(`/api/payment-terms/${term.id}`, "PATCH", {
      invoiceNo: strOrNull(fd.get("invoiceNo")),
      invoicedAt: strOrNull(fd.get("invoicedAt")),
      certifiedAt: strOrNull(fd.get("certifiedAt")),
      dueDate: strOrNull(fd.get("dueDate")),
      ...(term.type === "RETENTION" ? { retentionReleaseDate: strOrNull(fd.get("retentionReleaseDate")) } : {}),
    });
    setBusy(false);
    if (r.ok) {
      setOpen(false);
      router.refresh();
    } else setError(r.error);
  }

  return (
    <div className="mt-1">
      <button type="button" className={link} onClick={() => setOpen(!open)}>
        {open ? "Close" : "Billing details"}
      </button>
      {open && (
        <form onSubmit={onSubmit} className="mt-2 space-y-3 rounded-sm border border-ink-200 bg-ink-100/60 p-3">
          <p className="text-[11px] text-ink-600">
            An invoice isn’t cash received — only recorded payments reduce what’s owed. Lateness is only measured once a due date is entered.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor={`in-${term.id}`}>Invoice no.</Label>
              <Input id={`in-${term.id}`} name="invoiceNo" defaultValue={term.invoiceNo ?? ""} maxLength={60} />
            </div>
            <div>
              <Label htmlFor={`ia-${term.id}`}>Invoiced on</Label>
              <Input id={`ia-${term.id}`} name="invoicedAt" type="date" defaultValue={term.invoicedAt ?? ""} />
            </div>
            <div>
              <Label htmlFor={`ca-${term.id}`}>Client certified on</Label>
              <Input id={`ca-${term.id}`} name="certifiedAt" type="date" defaultValue={term.certifiedAt ?? ""} />
            </div>
            <div>
              <Label htmlFor={`dd-${term.id}`}>Payment due on</Label>
              <Input id={`dd-${term.id}`} name="dueDate" type="date" defaultValue={term.dueDate ?? ""} />
            </div>
            {term.type === "RETENTION" && (
              <div className="col-span-2">
                <Label htmlFor={`rr-${term.id}`}>Retention release date</Label>
                <Input id={`rr-${term.id}`} name="retentionReleaseDate" type="date" defaultValue={term.retentionReleaseDate ?? ""} />
              </div>
            )}
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <Button type="submit" disabled={busy} className="text-xs">
            {busy ? "Saving…" : "Save"}
          </Button>
        </form>
      )}
    </div>
  );
}
