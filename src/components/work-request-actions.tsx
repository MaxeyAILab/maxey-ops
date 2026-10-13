"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label, Textarea } from "@/components/ui";
import { PhotoInput } from "@/components/photo-input";

async function send(url: string, method: string, body: unknown) {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (res.ok) return { ok: true as const };
  return { ok: false as const, error: ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Something went wrong" };
}

/** Client portal: ask for additional work. Nothing here commits the client to a price. */
export function NewWorkRequestForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setDone("");
    const form = e.currentTarget;
    const fd = new FormData(form);
    const r = await send("/api/work-requests", "POST", {
      projectId,
      title: fd.get("title"),
      description: fd.get("description"),
      photos,
    });
    setBusy(false);
    if (r.ok) {
      form.reset();
      setPhotos([]);
      setDone("Thank you — your request was sent. Our team will review it and get back to you.");
      router.refresh();
    } else setError(r.error);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div>
        <Label htmlFor={`aw-title-${projectId}`}>What would you like added or changed? *</Label>
        <Input id={`aw-title-${projectId}`} name="title" required minLength={3} maxLength={200} placeholder="e.g., Add a covered walkway at the entrance" />
      </div>
      <div>
        <Label htmlFor={`aw-desc-${projectId}`}>Details *</Label>
        <Textarea id={`aw-desc-${projectId}`} name="description" rows={4} required minLength={3} maxLength={5000} placeholder="Where, how big, any materials or finishes you have in mind…" />
      </div>
      <PhotoInput label="Photos or sketches (optional)" max={4} onChange={setPhotos} />
      <p className="text-xs text-ink-500">
        Sending a request doesn’t commit you to anything. We’ll assess it and, if it goes ahead, send you a formal change order with the price and
        time impact for your approval.
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {done && <p className="text-sm text-emerald-700">{done}</p>}
      <Button type="submit" disabled={busy}>
        {busy ? "Sending…" : "Send request"}
      </Button>
    </form>
  );
}

export function WithdrawWorkRequestButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <span>
      <button
        type="button"
        disabled={busy}
        className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
        onClick={async () => {
          if (!confirm("Withdraw this request?")) return;
          setBusy(true);
          const r = await send(`/api/work-requests/${id}`, "PATCH", { action: "withdraw" });
          setBusy(false);
          if (r.ok) router.refresh();
          else setError(r.error);
        }}
      >
        {busy ? "…" : "Withdraw request"}
      </button>
      {error && <span className="ml-2 text-xs text-red-600">{error}</span>}
    </span>
  );
}

export interface WorkRequestControlProps {
  id: string;
  status: "REQUESTED" | "UNDER_REVIEW" | "CONVERTED" | "DECLINED" | "WITHDRAWN";
  title: string;
  description: string;
  estimatedCost: number | null;
  estimatedDays: number | null;
  internalNote: string | null;
}

/** Owner/PM: acknowledge, price, send to the client as a change order, or decline. */
export function WorkRequestControls({ wr }: { wr: WorkRequestControlProps }) {
  const router = useRouter();
  const [mode, setMode] = useState<null | "assess" | "convert" | "decline">(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(body: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    const r = await send(`/api/work-requests/${wr.id}`, "PATCH", body);
    setBusy(false);
    if (r.ok) {
      setMode(null);
      router.refresh();
    } else setError(r.error);
  }

  if (wr.status !== "REQUESTED" && wr.status !== "UNDER_REVIEW") return null;

  const numOrNull = (v: FormDataEntryValue | null) => (v === null || v === "" ? null : Number(v));
  const link = "text-xs font-medium text-brand-600 hover:underline";

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-3">
        {wr.status === "REQUESTED" && (
          <button type="button" className={link} disabled={busy} onClick={() => run({ action: "acknowledge" })}>
            Acknowledge (start review)
          </button>
        )}
        <button type="button" className={link} onClick={() => setMode(mode === "assess" ? null : "assess")}>
          Assess &amp; price
        </button>
        <button
          type="button"
          className="min-h-[32px] rounded-sm bg-brand-500 px-3 text-xs font-semibold text-white hover:bg-brand-600"
          onClick={() => setMode(mode === "convert" ? null : "convert")}
        >
          Send to client as change order
        </button>
        <button type="button" className="text-xs font-medium text-red-600 hover:underline" onClick={() => setMode(mode === "decline" ? null : "decline")}>
          Decline
        </button>
      </div>

      {mode === "assess" && (
        <form
          className="mt-2 space-y-3 rounded-sm border border-ink-200 bg-ink-100/60 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            run({ action: "assess", estimatedCost: numOrNull(fd.get("estimatedCost")), estimatedDays: numOrNull(fd.get("estimatedDays")), internalNote: (fd.get("internalNote") as string) || null });
          }}
        >
          <p className="text-xs text-ink-600">Your estimate and notes stay internal. The client only sees a price once you send a change order.</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor={`ec-${wr.id}`}>Estimated cost (PHP)</Label>
              <Input id={`ec-${wr.id}`} name="estimatedCost" type="number" min="0" step="0.01" defaultValue={wr.estimatedCost ?? ""} />
            </div>
            <div>
              <Label htmlFor={`ed-${wr.id}`}>Estimated time (days)</Label>
              <Input id={`ed-${wr.id}`} name="estimatedDays" type="number" min="0" step="1" defaultValue={wr.estimatedDays ?? ""} />
            </div>
          </div>
          <div>
            <Label htmlFor={`in-${wr.id}`}>Internal note</Label>
            <Textarea id={`in-${wr.id}`} name="internalNote" rows={2} maxLength={2000} defaultValue={wr.internalNote ?? ""} />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy} className="text-xs">
              {busy ? "Saving…" : "Save assessment"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setMode(null)} className="text-xs">
              Cancel
            </Button>
          </div>
        </form>
      )}

      {mode === "convert" && (
        <form
          className="mt-2 space-y-3 rounded-sm border border-brand-200 bg-brand-50 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            run({
              action: "convert",
              costImpact: numOrNull(fd.get("costImpact")),
              timeImpactDays: numOrNull(fd.get("timeImpactDays")),
              title: fd.get("title"),
              description: fd.get("description"),
            });
          }}
        >
          <p className="text-xs text-ink-700">
            This creates a normal change order for the client to approve or reject. The contract value only changes if they approve it.
          </p>
          <div>
            <Label htmlFor={`ct-${wr.id}`}>Change order title</Label>
            <Input id={`ct-${wr.id}`} name="title" defaultValue={wr.title} required minLength={3} maxLength={200} />
          </div>
          <div>
            <Label htmlFor={`cd-${wr.id}`}>Scope shown to the client</Label>
            <Textarea id={`cd-${wr.id}`} name="description" rows={3} defaultValue={wr.description} required minLength={3} maxLength={5000} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor={`cc-${wr.id}`}>Cost impact (PHP) *</Label>
              <Input id={`cc-${wr.id}`} name="costImpact" type="number" min="0" step="0.01" required defaultValue={wr.estimatedCost ?? ""} />
            </div>
            <div>
              <Label htmlFor={`cdy-${wr.id}`}>Time impact (days) *</Label>
              <Input id={`cdy-${wr.id}`} name="timeImpactDays" type="number" min="0" step="1" required defaultValue={wr.estimatedDays ?? ""} />
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy} className="text-xs">
              {busy ? "Sending…" : "Send change order to client"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setMode(null)} className="text-xs">
              Cancel
            </Button>
          </div>
        </form>
      )}

      {mode === "decline" && (
        <form
          className="mt-2 space-y-3 rounded-sm border border-red-300 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/30"
          onSubmit={(e) => {
            e.preventDefault();
            run({ action: "decline", reason: new FormData(e.currentTarget).get("reason") });
          }}
        >
          <div>
            <Label htmlFor={`dr-${wr.id}`}>Reason (the client will see this) *</Label>
            <Textarea id={`dr-${wr.id}`} name="reason" rows={2} required minLength={5} maxLength={1000} />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy} className="text-xs">
              {busy ? "Saving…" : "Decline request"}
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
