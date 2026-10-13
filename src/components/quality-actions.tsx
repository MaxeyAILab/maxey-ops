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

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (res.ok) return { ok: true as const };
  return { ok: false as const, error: ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Something went wrong" };
}

const strOrNull = (v: FormDataEntryValue | null) => (v ? String(v) : null);
const link = "text-xs font-medium text-brand-600 hover:underline";

// ---------- raise a finding (works offline on site) ----------

export function NewFindingForm({ projectId, staff }: { projectId: string; staff: Option[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [type, setType] = useState("DEFECT");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setNote("");
    const form = e.currentTarget;
    const fd = new FormData(form);
    const r = await submitOrQueue({
      url: "/api/findings",
      label: `Finding: ${fd.get("title")}`,
      body: {
        projectId,
        type: fd.get("type"),
        severity: fd.get("severity"),
        title: fd.get("title"),
        description: fd.get("description"),
        location: strOrNull(fd.get("location")),
        workItem: strOrNull(fd.get("workItem")),
        ownerId: strOrNull(fd.get("ownerId")),
        dueDate: strOrNull(fd.get("dueDate")),
        photos,
      },
    });
    setBusy(false);
    if (r.ok) {
      form.reset();
      setPhotos([]);
      setType("DEFECT");
      setNote(r.queued ? "No signal — saved on this device and it will send automatically when you're back online." : "Finding recorded.");
      router.refresh();
    } else setError(r.error ?? "Could not save the finding");
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="fd-type">Type *</Label>
          <Select id="fd-type" name="type" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="DEFECT">Defect</option>
            <option value="PUNCH_ITEM">Punch item</option>
            <option value="INSPECTION">Inspection finding</option>
            <option value="SAFETY_OBSERVATION">Safety observation</option>
            <option value="INCIDENT">Incident (restricted)</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="fd-sev">Severity *</Label>
          <Select id="fd-sev" name="severity" defaultValue="MEDIUM">
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
            <option value="CRITICAL">Critical</option>
          </Select>
        </div>
      </div>
      {type === "INCIDENT" && (
        <p className="rounded-sm bg-amber-50 px-2 py-1 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          Incidents are restricted: only the Owner, the PM, you and the person you assign can see this.
        </p>
      )}
      <div>
        <Label htmlFor="fd-title">Title *</Label>
        <Input id="fd-title" name="title" required minLength={3} maxLength={200} placeholder="e.g., Honeycombing on column C-4" />
      </div>
      <div>
        <Label htmlFor="fd-desc">What did you find? *</Label>
        <Textarea id="fd-desc" name="description" rows={3} required minLength={3} maxLength={5000} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="fd-loc">Location</Label>
          <Input id="fd-loc" name="location" maxLength={200} placeholder="e.g., Level 2, grid C-4" />
        </div>
        <div>
          <Label htmlFor="fd-wi">Work item</Label>
          <Input id="fd-wi" name="workItem" maxLength={200} />
        </div>
        <div>
          <Label htmlFor="fd-own">Who fixes it</Label>
          <Select id="fd-own" name="ownerId" defaultValue="">
            <option value="">— assign later —</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="fd-due">Fix by</Label>
          <Input id="fd-due" name="dueDate" type="date" />
        </div>
      </div>
      <PhotoInput label="Photos" max={4} onChange={setPhotos} />
      {error && <p className="text-sm text-red-600">{error}</p>}
      {note && <p className="text-sm text-emerald-700">{note}</p>}
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? "Saving…" : "Record finding"}
      </Button>
    </form>
  );
}

export interface FindingControlProps {
  id: string;
  status: "OPEN" | "IN_PROGRESS" | "READY_FOR_REVIEW" | "CLOSED";
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  ownerId: string | null;
  dueDate: string | null;
  canWork: boolean;
  canClose: boolean;
  canSendBack: boolean;
  canReopen: boolean;
  canEdit: boolean;
}

export function FindingControls({ f, staff }: { f: FindingControlProps; staff: Option[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<null | "submit" | "back" | "reopen" | "edit">(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);

  async function run(body: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    const r = await send(`/api/findings/${f.id}`, "PATCH", body);
    setBusy(false);
    if (r.ok) {
      setMode(null);
      setPhotos([]);
      router.refresh();
    } else setError(r.error);
  }

  const cancel = (
    <Button type="button" variant="secondary" onClick={() => setMode(null)} className="text-xs">
      Cancel
    </Button>
  );

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-3">
        {f.status === "OPEN" && f.canWork && (
          <button type="button" className={link} disabled={busy} onClick={() => run({ action: "start" })}>
            Start work
          </button>
        )}
        {(f.status === "OPEN" || f.status === "IN_PROGRESS") && f.canWork && (
          <button type="button" className="min-h-[32px] rounded-sm bg-brand-500 px-3 text-xs font-semibold text-white hover:bg-brand-600" onClick={() => setMode(mode === "submit" ? null : "submit")}>
            Submit fix for review
          </button>
        )}
        {f.status === "READY_FOR_REVIEW" && f.canClose && (
          <button type="button" className="min-h-[32px] rounded-sm bg-brand-500 px-3 text-xs font-semibold text-white hover:bg-brand-600" disabled={busy} onClick={() => run({ action: "close" })}>
            ✓ Accept &amp; close
          </button>
        )}
        {f.status === "READY_FOR_REVIEW" && f.canSendBack && (
          <button type="button" className={link} onClick={() => setMode(mode === "back" ? null : "back")}>
            Send back
          </button>
        )}
        {f.status === "CLOSED" && f.canReopen && (
          <button type="button" className={link} onClick={() => setMode(mode === "reopen" ? null : "reopen")}>
            Reopen
          </button>
        )}
        {f.canEdit && f.status !== "CLOSED" && (
          <button type="button" className={link} onClick={() => setMode(mode === "edit" ? null : "edit")}>
            Assign / edit
          </button>
        )}
      </div>

      {mode === "submit" && (
        <form
          className="mt-2 space-y-3 rounded-sm border border-ink-200 bg-ink-100/60 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            run({ action: "submit_closure", note: new FormData(e.currentTarget).get("note"), photos });
          }}
        >
          <div>
            <Label htmlFor={`cn-${f.id}`}>What was done? *</Label>
            <Textarea id={`cn-${f.id}`} name="note" rows={3} required minLength={5} maxLength={3000} />
          </div>
          <PhotoInput label={f.severity === "HIGH" || f.severity === "CRITICAL" ? "Photos of the fix (required)" : "Photos of the fix"} max={4} onChange={setPhotos} />
          <p className="text-[11px] text-ink-500">A PM or the Owner — not you — reviews it before it is closed.</p>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy} className="text-xs">
              {busy ? "Sending…" : "Submit for review"}
            </Button>
            {cancel}
          </div>
        </form>
      )}

      {(mode === "back" || mode === "reopen") && (
        <form
          className="mt-2 space-y-3 rounded-sm border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30"
          onSubmit={(e) => {
            e.preventDefault();
            run({ action: mode === "back" ? "send_back" : "reopen", note: new FormData(e.currentTarget).get("note") });
          }}
        >
          <div>
            <Label htmlFor={`rv-${f.id}`}>{mode === "back" ? "What still needs fixing? *" : "Why is it being reopened? *"}</Label>
            <Textarea id={`rv-${f.id}`} name="note" rows={2} required minLength={3} maxLength={2000} />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy} className="text-xs">
              {busy ? "Saving…" : mode === "back" ? "Send back" : "Reopen"}
            </Button>
            {cancel}
          </div>
        </form>
      )}

      {mode === "edit" && (
        <form
          className="mt-2 space-y-3 rounded-sm border border-ink-200 bg-ink-100/60 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            run({ action: "update", ownerId: strOrNull(fd.get("ownerId")), dueDate: strOrNull(fd.get("dueDate")), severity: fd.get("severity") });
          }}
        >
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor={`eo-${f.id}`}>Who fixes it</Label>
              <Select id={`eo-${f.id}`} name="ownerId" defaultValue={f.ownerId ?? ""}>
                <option value="">— unassigned —</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor={`ed-${f.id}`}>Fix by</Label>
              <Input id={`ed-${f.id}`} name="dueDate" type="date" defaultValue={f.dueDate ?? ""} />
            </div>
            <div>
              <Label htmlFor={`es-${f.id}`}>Severity</Label>
              <Select id={`es-${f.id}`} name="severity" defaultValue={f.severity}>
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
                <option value="CRITICAL">Critical</option>
              </Select>
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy} className="text-xs">
              {busy ? "Saving…" : "Save"}
            </Button>
            {cancel}
          </div>
        </form>
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

// ---------- closeout checklist ----------

export interface CloseoutItemProps {
  id: string;
  title: string;
  category: string | null;
  required: boolean;
  done: boolean;
  doneByName: string | null;
  doneAt: string | null;
  note: string | null;
}

export function CloseoutChecklist({ projectId, items, canEdit }: { projectId: string; items: CloseoutItemProps[]; canEdit: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function act(key: string, fn: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    if (busy) return;
    setBusy(key);
    setError("");
    const r = await fn();
    setBusy(null);
    if (r.ok) router.refresh();
    else setError(r.error);
  }

  return (
    <div className="space-y-3">
      {items.length === 0 && canEdit && (
        <Button type="button" disabled={busy !== null} onClick={() => act("tpl", () => send("/api/closeout", "POST", { action: "template", projectId }))}>
          {busy === "tpl" ? "Creating…" : "Start the standard closeout checklist"}
        </Button>
      )}
      {items.length === 0 && !canEdit && <p className="text-sm text-ink-500">No closeout checklist yet.</p>}
      <ul className="space-y-1.5">
        {items.map((i) => (
          <li key={i.id} className="flex items-start gap-3 rounded-sm border border-ink-100 px-3 py-2 text-sm">
            <input
              type="checkbox"
              checked={i.done}
              disabled={!canEdit || busy !== null}
              onChange={(e) => act(i.id, () => send(`/api/closeout/${i.id}`, "PATCH", { done: e.target.checked }))}
              className="mt-0.5 h-5 w-5 shrink-0"
              aria-label={`Mark “${i.title}” ${i.done ? "not done" : "done"}`}
            />
            <div className="min-w-0 flex-1">
              <div className={i.done ? "text-ink-500 line-through" : "text-ink-900"}>
                {i.title}
                {!i.required && <span className="ml-1.5 text-[11px] text-ink-400">(optional)</span>}
              </div>
              <div className="text-[11px] text-ink-500">
                {i.category && <>{i.category} · </>}
                {i.done && i.doneByName && i.doneAt ? `Done by ${i.doneByName}, ${i.doneAt}` : "Not done yet"}
              </div>
            </div>
            {canEdit && (
              <button
                type="button"
                className="text-[11px] text-red-600 hover:underline"
                disabled={busy !== null}
                onClick={() => confirm(`Remove “${i.title}” from the checklist?`) && act(`rm-${i.id}`, () => send(`/api/closeout/${i.id}`, "DELETE"))}
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      {canEdit && items.length > 0 && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const fd = new FormData(form);
            act("add", async () => {
              const r = await send("/api/closeout", "POST", { action: "add", projectId, title: fd.get("title"), required: fd.get("required") === "on" });
              if (r.ok) form.reset();
              return r;
            });
          }}
        >
          <div className="min-w-[200px] flex-1">
            <Label htmlFor="co-title">Add an item</Label>
            <Input id="co-title" name="title" required minLength={3} maxLength={200} />
          </div>
          <label className="mb-2 flex items-center gap-1.5 text-xs text-ink-700">
            <input type="checkbox" name="required" defaultChecked className="h-4 w-4" /> required
          </label>
          <Button type="submit" disabled={busy !== null} className="text-xs">
            Add
          </Button>
        </form>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

// ---------- documents ----------

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Couldn't read that file"));
    r.readAsDataURL(file);
  });
}

/** Builds the link-or-file part of the request from a form. */
async function fileSourceFrom(fd: FormData): Promise<Record<string, unknown>> {
  const file = fd.get("file");
  if (file instanceof File && file.size > 0) return { dataUrl: await readFile(file), fileName: file.name };
  return { link: strOrNull(fd.get("link")) };
}

const CATEGORY_OPTIONS = [
  ["DRAWING", "Drawing"],
  ["SPECIFICATION", "Specification"],
  ["PERMIT", "Permit"],
  ["CONTRACT", "Contract"],
  ["REPORT", "Report"],
  ["OTHER", "Other"],
] as const;

export function AddDocumentForm({ projectId }: { projectId: string }) {
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
    try {
      const r = await send("/api/documents", "POST", {
        projectId,
        title: fd.get("title"),
        docNo: strOrNull(fd.get("docNo")),
        category: fd.get("category"),
        revision: fd.get("revision") || "A",
        visibleToClient: fd.get("visibleToClient") === "on",
        notes: strOrNull(fd.get("notes")),
        ...(await fileSourceFrom(fd)),
      });
      if (r.ok) {
        form.reset();
        router.refresh();
      } else setError(r.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
    setBusy(false);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Label htmlFor="doc-title">Title *</Label>
          <Input id="doc-title" name="title" required minLength={3} maxLength={200} placeholder="e.g., Ground floor plan" />
        </div>
        <div>
          <Label htmlFor="doc-no">Drawing / document no.</Label>
          <Input id="doc-no" name="docNo" maxLength={60} placeholder="e.g., A-101" />
        </div>
        <div>
          <Label htmlFor="doc-cat">Category</Label>
          <Select id="doc-cat" name="category" defaultValue="DRAWING">
            {CATEGORY_OPTIONS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="doc-rev">Revision</Label>
          <Input id="doc-rev" name="revision" defaultValue="A" maxLength={40} />
        </div>
      </div>
      <div>
        <Label htmlFor="doc-link">Link to the file (Google Drive, SharePoint…)</Label>
        <Input id="doc-link" name="link" type="url" placeholder="https://…" />
      </div>
      <div>
        <Label htmlFor="doc-file">…or upload a small file (PDF/JPG/PNG, max 3 MB)</Label>
        <input id="doc-file" name="file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="block w-full text-sm" />
      </div>
      <div>
        <Label htmlFor="doc-notes">Notes</Label>
        <Input id="doc-notes" name="notes" maxLength={1000} placeholder="e.g., Issued for construction" />
      </div>
      <label className="flex items-center gap-2 text-sm text-ink-700">
        <input type="checkbox" name="visibleToClient" className="h-4 w-4" /> Share with the client in their portal
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? "Saving…" : "Add document"}
      </Button>
    </form>
  );
}

export function DocumentControls({ id, visibleToClient, isOwner, suggestedRevision }: { id: string; visibleToClient: boolean; isOwner: boolean; suggestedRevision: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await fn();
      if (r.ok) {
        setOpen(false);
        router.refresh();
      } else setError(r.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
    setBusy(false);
  }

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={link} onClick={() => setOpen(!open)}>
          {open ? "Close" : "Issue new revision"}
        </button>
        <button type="button" className={link} disabled={busy} onClick={() => run(() => send(`/api/documents/${id}`, "PATCH", { visibleToClient: !visibleToClient }))}>
          {visibleToClient ? "Stop sharing with client" : "Share with client"}
        </button>
        {isOwner && (
          <button type="button" className="text-xs font-medium text-red-600 hover:underline" onClick={() => confirm("Delete this document and all its revisions? The audit trail keeps a record.") && run(() => send(`/api/documents/${id}`, "DELETE"))}>
            Delete
          </button>
        )}
      </div>
      {open && (
        <form
          className="mt-2 space-y-3 rounded-sm border border-ink-200 bg-ink-100/60 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            run(async () => send(`/api/documents/${id}/revisions`, "POST", { revision: strOrNull(fd.get("revision")) ?? undefined, notes: strOrNull(fd.get("notes")), ...(await fileSourceFrom(fd)) }));
          }}
        >
          <p className="text-[11px] text-ink-600">The current revision is kept as “superseded” — nothing is overwritten.</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor={`rv-${id}`}>Revision</Label>
              <Input id={`rv-${id}`} name="revision" defaultValue={suggestedRevision} maxLength={40} />
            </div>
            <div>
              <Label htmlFor={`rn-${id}`}>What changed</Label>
              <Input id={`rn-${id}`} name="notes" maxLength={1000} />
            </div>
          </div>
          <div>
            <Label htmlFor={`rl-${id}`}>Link to the file</Label>
            <Input id={`rl-${id}`} name="link" type="url" placeholder="https://…" />
          </div>
          <div>
            <Label htmlFor={`rf-${id}`}>…or upload (PDF/JPG/PNG, max 3 MB)</Label>
            <input id={`rf-${id}`} name="file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="block w-full text-sm" />
          </div>
          <Button type="submit" disabled={busy} className="text-xs">
            {busy ? "Saving…" : "Issue revision"}
          </Button>
        </form>
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
