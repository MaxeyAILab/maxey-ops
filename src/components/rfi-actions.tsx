"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label, Select, Textarea } from "@/components/ui";
import { PhotoInput } from "@/components/photo-input";
import { submitOrQueue } from "@/lib/outbox";

interface Option {
  id: string;
  label: string;
}

async function send(url: string, method: string, body: unknown) {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (res.ok) return { ok: true as const };
  return { ok: false as const, error: ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Something went wrong" };
}

const IMPACT_OPTIONS = [
  ["UNKNOWN", "Unknown (not assessed)"],
  ["NONE_IDENTIFIED", "None identified"],
  ["POSSIBLE", "Possible"],
  ["ASSESSED", "Assessed"],
] as const;

function ImpactFields({
  idPrefix,
  cost,
  schedule,
  days,
  note,
}: {
  idPrefix: string;
  cost: string;
  schedule: string;
  days: number | null;
  note: string | null;
}) {
  return (
    <div className="space-y-3 rounded-sm border border-ink-200 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Potential impact</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor={`${idPrefix}-ci`}>Cost</Label>
          <Select id={`${idPrefix}-ci`} name="costImpact" defaultValue={cost}>
            {IMPACT_OPTIONS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-si`}>Schedule</Label>
          <Select id={`${idPrefix}-si`} name="scheduleImpact" defaultValue={schedule}>
            {IMPACT_OPTIONS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor={`${idPrefix}-sd`}>Schedule days (if known)</Label>
          <Input id={`${idPrefix}-sd`} name="scheduleImpactDays" type="number" defaultValue={days ?? ""} />
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-in`}>Note</Label>
          <Input id={`${idPrefix}-in`} name="impactNote" defaultValue={note ?? ""} maxLength={1000} />
        </div>
      </div>
    </div>
  );
}

export function NewRfiForm({
  projectId,
  canSendToClient,
  staff,
  milestones,
  documents = [],
}: {
  projectId: string;
  canSendToClient: boolean;
  staff: Option[];
  milestones: Option[];
  documents?: Option[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [addressedTo, setAddressedTo] = useState<"INTERNAL" | "CLIENT">("INTERNAL");
  const [photos, setPhotos] = useState<string[]>([]);
  const [savedNote, setSavedNote] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const form = e.currentTarget;
    const fd = new FormData(form);
    const v = (k: string) => (fd.get(k) as string) || null;
    // Goes through the offline outbox: with no signal it is kept on the device and sent later,
    // and the idempotency key means it can never be raised twice.
    const r = await submitOrQueue({
      url: "/api/rfis",
      label: `RFI: ${fd.get("subject")}`,
      body: {
        projectId,
        subject: fd.get("subject"),
        question: fd.get("question"),
        addressedTo,
        assigneeId: addressedTo === "INTERNAL" ? v("assigneeId") : null,
        dueDate: v("dueDate"),
        workItem: v("workItem"),
        dailyReportNo: v("dailyReportNo"),
        milestoneId: v("milestoneId"),
        documentId: v("documentId"),
        photos,
      },
    });
    setBusy(false);
    if (r.ok) {
      form.reset();
      setPhotos([]);
      setSavedNote(r.queued ? "No signal — saved on this device and it will send automatically when you're back online." : "");
      router.refresh();
    } else setError(r.error ?? "Could not save the RFI");
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div>
        <Label htmlFor="rfi-subject">Subject *</Label>
        <Input id="rfi-subject" name="subject" required minLength={3} maxLength={200} placeholder="e.g., Rebar spacing at grid C-4" />
      </div>
      <div>
        <Label htmlFor="rfi-question">Question *</Label>
        <Textarea id="rfi-question" name="question" rows={3} required minLength={3} maxLength={5000} />
      </div>
      {canSendToClient && (
        <div>
          <Label htmlFor="rfi-to">Who answers?</Label>
          <Select id="rfi-to" value={addressedTo} onChange={(e) => setAddressedTo(e.target.value as "INTERNAL" | "CLIENT")}>
            <option value="INTERNAL">Maxey staff (internal)</option>
            <option value="CLIENT">The client (answers in their portal)</option>
          </Select>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        {addressedTo === "INTERNAL" && (
          <div>
            <Label htmlFor="rfi-assignee">Assign to</Label>
            <Select id="rfi-assignee" name="assigneeId" defaultValue="">
              <option value="">Owner / PM / project engineer or architect</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </Select>
          </div>
        )}
        <div>
          <Label htmlFor="rfi-due">Answer needed by</Label>
          <Input id="rfi-due" name="dueDate" type="date" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="rfi-wi">Related work item</Label>
          <Input id="rfi-wi" name="workItem" maxLength={200} placeholder="optional" />
        </div>
        <div>
          <Label htmlFor="rfi-dr">Related daily report</Label>
          <Input id="rfi-dr" name="dailyReportNo" maxLength={40} placeholder="e.g., DCR-004" />
        </div>
      </div>
      {milestones.length > 0 && (
        <div>
          <Label htmlFor="rfi-ms">Related milestone</Label>
          <Select id="rfi-ms" name="milestoneId" defaultValue="">
            <option value="">— none —</option>
            {milestones.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </Select>
        </div>
      )}
      {documents.length > 0 && (
        <div>
          <Label htmlFor="rfi-doc">Related drawing / document</Label>
          <Select id="rfi-doc" name="documentId" defaultValue="">
            <option value="">— none —</option>
            {documents.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </Select>
        </div>
      )}
      <PhotoInput label="Photos / sketches" max={4} onChange={setPhotos} />
      {error && <p className="text-sm text-red-600">{error}</p>}
      {savedNote && <p className="text-sm text-emerald-700">{savedNote}</p>}
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? "Sending…" : addressedTo === "CLIENT" ? "Send to client" : "Raise RFI"}
      </Button>
    </form>
  );
}

export interface RfiControlProps {
  id: string;
  status: "OPEN" | "ANSWERED" | "CLOSED" | "CANCELLED";
  addressedTo: "INTERNAL" | "CLIENT";
  assigneeId: string | null;
  dueDate: string | null;
  workItem: string | null;
  dailyReportNo: string | null;
  milestoneId: string | null;
  siteInstructionId: string | null;
  changeOrderId: string | null;
  costImpact: string;
  scheduleImpact: string;
  scheduleImpactDays: number | null;
  impactNote: string | null;
  canRespond: boolean;
  canApproveForeman: boolean; // Owner only: this RFI is assigned to a foreman who needs approval to answer
  foremanApproved: boolean;
  canClose: boolean;
  canCancel: boolean;
  canManage: boolean;
  documentId: string | null;
}

export function RfiControls({
  rfi,
  staff,
  milestones,
  instructions,
  changeOrders,
  documents = [],
}: {
  rfi: RfiControlProps;
  staff: Option[];
  milestones: Option[];
  instructions: Option[];
  changeOrders: Option[];
  documents?: Option[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<null | "answer" | "edit">(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);

  async function run(body: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    const r = await send(`/api/rfis/${rfi.id}`, "PATCH", body);
    setBusy(false);
    if (r.ok) {
      setMode(null);
      setPhotos([]);
      router.refresh();
    } else setError(r.error);
  }

  const num = (v: FormDataEntryValue | null) => (v === null || v === "" ? null : Number(v));
  const str = (v: FormDataEntryValue | null) => (v ? String(v) : null);

  function onAnswer(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    run({
      action: "respond",
      responseText: fd.get("responseText"),
      responsePhotos: photos,
      ...(rfi.canManage
        ? {
            costImpact: fd.get("costImpact"),
            scheduleImpact: fd.get("scheduleImpact"),
            scheduleImpactDays: num(fd.get("scheduleImpactDays")),
            impactNote: str(fd.get("impactNote")),
          }
        : {}),
    });
  }

  function onEdit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    run({
      action: "update",
      ...(rfi.addressedTo === "INTERNAL" ? { assigneeId: str(fd.get("assigneeId")) } : {}),
      dueDate: str(fd.get("dueDate")),
      workItem: str(fd.get("workItem")),
      dailyReportNo: str(fd.get("dailyReportNo")),
      milestoneId: str(fd.get("milestoneId")),
      siteInstructionId: str(fd.get("siteInstructionId")),
      changeOrderId: str(fd.get("changeOrderId")),
      documentId: str(fd.get("documentId")),
      costImpact: fd.get("costImpact"),
      scheduleImpact: fd.get("scheduleImpact"),
      scheduleImpactDays: num(fd.get("scheduleImpactDays")),
      impactNote: str(fd.get("impactNote")),
    });
  }

  const link = "text-xs font-medium text-brand-600 hover:underline";
  const optSelect = (name: string, label: string, options: Option[], value: string | null) => (
    <div>
      <Label htmlFor={`${name}-${rfi.id}`}>{label}</Label>
      <Select id={`${name}-${rfi.id}`} name={name} defaultValue={value ?? ""}>
        <option value="">— none —</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </Select>
    </div>
  );

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-3">
        {rfi.canRespond && (
          <button type="button" className="min-h-[32px] rounded-sm bg-brand-500 px-3 text-xs font-semibold text-white hover:bg-brand-600" onClick={() => setMode(mode === "answer" ? null : "answer")}>
            Answer
          </button>
        )}
        {rfi.canApproveForeman && !rfi.foremanApproved && (
          <button type="button" disabled={busy} className="min-h-[32px] rounded-sm border border-brand-500 px-3 text-xs font-semibold text-brand-600 hover:bg-brand-50" onClick={() => run({ action: "approve_answer" })}>
            Approve the foreman to answer
          </button>
        )}
        {rfi.canApproveForeman && rfi.foremanApproved && (
          <button type="button" disabled={busy} className={link} onClick={() => confirm("Take back the approval? The foreman will no longer be able to answer this RFI.") && run({ action: "revoke_answer" })}>
            Withdraw the foreman&apos;s approval
          </button>
        )}
        {rfi.canClose && (
          <button type="button" disabled={busy} className={link} onClick={() => run({ action: "close" })}>
            Confirm resolved &amp; close
          </button>
        )}
        {rfi.canManage && rfi.status === "ANSWERED" && (
          <button type="button" disabled={busy} className={link} onClick={() => confirm("Reopen this RFI for a new answer? The earlier answer stays in the audit trail.") && run({ action: "reopen" })}>
            Reopen
          </button>
        )}
        {rfi.canManage && rfi.status !== "CANCELLED" && rfi.status !== "CLOSED" && (
          <button type="button" className={link} onClick={() => setMode(mode === "edit" ? null : "edit")}>
            Edit details &amp; links
          </button>
        )}
        {rfi.canCancel && (
          <button type="button" disabled={busy} className="text-xs font-medium text-red-600 hover:underline" onClick={() => confirm("Cancel this RFI?") && run({ action: "cancel" })}>
            Cancel RFI
          </button>
        )}
      </div>

      {mode === "answer" && (
        <form onSubmit={onAnswer} className="mt-2 space-y-3 rounded-sm border border-ink-200 bg-ink-100/60 p-3">
          <div>
            <Label htmlFor={`ans-${rfi.id}`}>Your answer *</Label>
            <Textarea id={`ans-${rfi.id}`} name="responseText" rows={3} required minLength={2} maxLength={5000} />
          </div>
          <PhotoInput label="Photos / sketches" max={4} onChange={setPhotos} />
          {rfi.canManage && (
            <ImpactFields idPrefix={`ans-${rfi.id}`} cost={rfi.costImpact} schedule={rfi.scheduleImpact} days={rfi.scheduleImpactDays} note={rfi.impactNote} />
          )}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy} className="text-xs">
              {busy ? "Sending…" : "Send answer"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setMode(null)} className="text-xs">
              Cancel
            </Button>
          </div>
        </form>
      )}

      {mode === "edit" && (
        <form onSubmit={onEdit} className="mt-2 space-y-3 rounded-sm border border-ink-200 bg-ink-100/60 p-3">
          <div className="grid grid-cols-2 gap-3">
            {rfi.addressedTo === "INTERNAL" && (
              <div>
                <Label htmlFor={`as-${rfi.id}`}>Assigned to</Label>
                <Select id={`as-${rfi.id}`} name="assigneeId" defaultValue={rfi.assigneeId ?? ""}>
                  <option value="">Owner / PM / project engineer or architect</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            <div>
              <Label htmlFor={`du-${rfi.id}`}>Answer needed by</Label>
              <Input id={`du-${rfi.id}`} name="dueDate" type="date" defaultValue={rfi.dueDate ?? ""} />
            </div>
            <div>
              <Label htmlFor={`wi-${rfi.id}`}>Work item</Label>
              <Input id={`wi-${rfi.id}`} name="workItem" defaultValue={rfi.workItem ?? ""} maxLength={200} />
            </div>
            <div>
              <Label htmlFor={`dr-${rfi.id}`}>Daily report</Label>
              <Input id={`dr-${rfi.id}`} name="dailyReportNo" defaultValue={rfi.dailyReportNo ?? ""} maxLength={40} />
            </div>
          </div>
          {optSelect("milestoneId", "Milestone", milestones, rfi.milestoneId)}
          {optSelect("siteInstructionId", "Linked site instruction", instructions, rfi.siteInstructionId)}
          {optSelect("changeOrderId", "Linked change order", changeOrders, rfi.changeOrderId)}
          {documents.length > 0 && optSelect("documentId", "Related drawing / document", documents, rfi.documentId)}
          <ImpactFields idPrefix={`ed-${rfi.id}`} cost={rfi.costImpact} schedule={rfi.scheduleImpact} days={rfi.scheduleImpactDays} note={rfi.impactNote} />
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
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

/** Client portal: answer an RFI addressed to the client. */
export function ClientRfiRespond({ rfiId }: { rfiId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const fd = new FormData(e.currentTarget);
    const r = await send(`/api/rfis/${rfiId}`, "PATCH", { action: "respond", responseText: fd.get("responseText"), responsePhotos: photos });
    setBusy(false);
    if (r.ok) router.refresh();
    else setError(r.error);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div>
        <Label htmlFor={`cr-${rfiId}`}>Your answer *</Label>
        <Textarea id={`cr-${rfiId}`} name="responseText" rows={3} required minLength={2} maxLength={5000} />
      </div>
      <PhotoInput label="Attach photos or sketches (optional)" max={4} onChange={setPhotos} />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" disabled={busy}>
        {busy ? "Sending…" : "Send answer"}
      </Button>
    </form>
  );
}
