"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label, Select, Textarea } from "@/components/ui";
import { PhotoInput } from "@/components/photo-input";
import { submitOrQueue } from "@/lib/outbox";
import { KIND_HINT, KIND_LABEL, SOURCE_LABEL, STAFF_SOURCES, type WorkRequestKindLike } from "@/lib/work-requests";

const KINDS: WorkRequestKindLike[] = ["ADDITION", "CHANGE", "REDUCTION"];

async function send(url: string, method: string, body: unknown) {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (res.ok) return { ok: true as const };
  return { ok: false as const, error: ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Something went wrong" };
}

/** Client portal: ask for something to be added, changed or taken out. Nothing here commits the client to a price. */
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
      kind: fd.get("kind"),
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
      <fieldset>
        <legend className="mb-1 text-xs font-medium text-ink-700">What kind of request is it? *</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {KINDS.map((k, i) => (
            <label key={k} className="flex cursor-pointer items-start gap-2 rounded-lg border border-ink-200 p-2.5 text-sm has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50">
              <input type="radio" name="kind" value={k} defaultChecked={i === 0} className="mt-1" />
              <span>
                <span className="block font-medium text-ink-800">{KIND_LABEL[k]}</span>
                <span className="block text-xs text-ink-500">{KIND_HINT[k]}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <Label htmlFor={`aw-title-${projectId}`}>What would you like? *</Label>
        <Input id={`aw-title-${projectId}`} name="title" required minLength={3} maxLength={200} placeholder="e.g., Add a covered walkway at the entrance" />
      </div>
      <div>
        <Label htmlFor={`aw-desc-${projectId}`}>Details *</Label>
        <Textarea id={`aw-desc-${projectId}`} name="description" rows={4} required minLength={3} maxLength={5000} placeholder="Where, how big, any materials or finishes you have in mind…" />
      </div>
      <PhotoInput label="Photos or sketches (optional)" max={4} onChange={setPhotos} />
      <p className="text-xs text-ink-500">
        Sending a request doesn’t commit you to anything. We’ll price it and send you a quotation with the cost and time impact — nothing changes
        in your contract until you approve it.
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {done && <p className="text-sm text-emerald-700">{done}</p>}
      <Button type="submit" disabled={busy}>
        {busy ? "Sending…" : "Send request"}
      </Button>
    </form>
  );
}

/**
 * Staff (Owner / PM / Foreman): write down an instruction the client gave outside the portal —
 * who said it, how, and when — so it is on record and gets priced like any other request.
 * Goes through the offline outbox, so it can be recorded on site without signal.
 */
export function RecordInstructionForm({ projectId, today }: { projectId: string; today: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setNote("");
    const form = e.currentTarget;
    const fd = new FormData(form);
    const r = await submitOrQueue({
      url: "/api/work-requests",
      label: `Client instruction: ${fd.get("title")}`,
      body: {
        projectId,
        kind: fd.get("kind"),
        source: fd.get("source"),
        instructedByName: fd.get("instructedByName"),
        instructedOn: fd.get("instructedOn"),
        title: fd.get("title"),
        description: fd.get("description"),
        photos,
      },
    });
    setBusy(false);
    if (r.ok) {
      form.reset();
      setPhotos([]);
      setNote(r.queued ? "No signal — saved on this device and it will be recorded automatically when you are back online." : "Recorded. The Owner or PM can now price it.");
      router.refresh();
    } else setError(r.error ?? "Could not record the instruction");
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <p className="text-xs text-ink-600">
        Use this when the client tells you something outside the portal — a call, a message, an email, a meeting or on site. It becomes a request that gets priced,
        and the client can see it was recorded.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="ri-by">Who at the client said it? *</Label>
          <Input id="ri-by" name="instructedByName" required minLength={2} maxLength={120} placeholder="e.g., Engr. Santos" />
        </div>
        <div>
          <Label htmlFor="ri-source">How was it given? *</Label>
          <Select id="ri-source" name="source" defaultValue="PHONE">
            {STAFF_SOURCES.map((k) => (
              <option key={k} value={k}>
                {SOURCE_LABEL[k]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="ri-date">Day it was given *</Label>
          <Input id="ri-date" name="instructedOn" type="date" required defaultValue={today} max={today} />
        </div>
        <div>
          <Label htmlFor="ri-kind">Kind of request *</Label>
          <Select id="ri-kind" name="kind" defaultValue="ADDITION">
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div>
        <Label htmlFor="ri-title">What did they ask for? *</Label>
        <Input id="ri-title" name="title" required minLength={3} maxLength={200} placeholder="e.g., Move the partition wall 600mm to the east" />
      </div>
      <div>
        <Label htmlFor="ri-desc">Details — their words as closely as you can *</Label>
        <Textarea id="ri-desc" name="description" rows={3} required minLength={3} maxLength={5000} />
      </div>
      <PhotoInput label="Screenshot of the message / photo (optional)" max={4} onChange={setPhotos} />
      {error && <p className="text-sm text-red-600">{error}</p>}
      {note && <p className="text-sm text-emerald-700">{note}</p>}
      <Button type="submit" disabled={busy} className="w-full sm:w-auto">
        {busy ? "Recording…" : "Record instruction"}
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
  kind: WorkRequestKindLike;
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

  // A reduction is typed as a positive "credit to the client" and stored as a negative price.
  const isReduction = wr.kind === "REDUCTION";
  const sign = isReduction ? -1 : 1;
  const shownCost = wr.estimatedCost == null ? "" : String(isReduction ? Math.abs(wr.estimatedCost) : wr.estimatedCost);
  const costMin = wr.kind === "CHANGE" ? undefined : "0";
  const costLabel = isReduction ? "Credit to the client (PHP) *" : wr.kind === "CHANGE" ? "Cost impact (PHP, minus if cheaper) *" : "Cost impact (PHP) *";

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
          Price &amp; send quotation to client
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
            const est = numOrNull(fd.get("estimatedCost"));
            run({ action: "assess", estimatedCost: est == null ? null : est * sign, estimatedDays: numOrNull(fd.get("estimatedDays")), internalNote: (fd.get("internalNote") as string) || null });
          }}
        >
          <p className="text-xs text-ink-600">Your estimate and notes stay internal. The client only sees a price once you send a change order.</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor={`ec-${wr.id}`}>{isReduction ? "Estimated credit (PHP)" : "Estimated cost (PHP)"}</Label>
              <Input id={`ec-${wr.id}`} name="estimatedCost" type="number" min={costMin} step="0.01" defaultValue={shownCost} />
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
            const cost = numOrNull(fd.get("costImpact"));
            run({
              action: "convert",
              costImpact: cost == null ? null : cost * sign,
              timeImpactDays: numOrNull(fd.get("timeImpactDays")),
              title: fd.get("title"),
              description: fd.get("description"),
            });
          }}
        >
          <p className="text-xs text-ink-700">
            This sends the client a quotation (a normal change order) to approve or reject. The contract value only changes if they approve it.
            {isReduction && " A reduction lowers the contract by the credit you enter."}
          </p>
          <div>
            <Label htmlFor={`ct-${wr.id}`}>Quotation title</Label>
            <Input id={`ct-${wr.id}`} name="title" defaultValue={wr.title} required minLength={3} maxLength={200} />
          </div>
          <div>
            <Label htmlFor={`cd-${wr.id}`}>Scope shown to the client</Label>
            <Textarea id={`cd-${wr.id}`} name="description" rows={3} defaultValue={wr.description} required minLength={3} maxLength={5000} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor={`cc-${wr.id}`}>{costLabel}</Label>
              <Input id={`cc-${wr.id}`} name="costImpact" type="number" min={costMin} step="0.01" required defaultValue={shownCost} />
            </div>
            <div>
              <Label htmlFor={`cdy-${wr.id}`}>Time impact (days) *</Label>
              <Input id={`cdy-${wr.id}`} name="timeImpactDays" type="number" min="0" step="1" required defaultValue={wr.estimatedDays ?? ""} />
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy} className="text-xs">
              {busy ? "Sending…" : "Send quotation to client"}
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
