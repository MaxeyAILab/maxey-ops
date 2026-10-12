"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label, Select, Textarea } from "@/components/ui";

interface Staff {
  id: string;
  name: string;
}

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.ok) return { ok: true as const };
  return { ok: false as const, error: ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Something went wrong" };
}

export function AddMilestoneForm({ projectId, isOwner, staff }: { projectId: string; isOwner: boolean; staff: Staff[] }) {
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
    const v = (k: string) => (fd.get(k) as string) || null;
    const r = await send("/api/milestones", "POST", {
      projectId,
      title: fd.get("title"),
      description: v("description"),
      ...(isOwner ? { baselineStart: v("baselineStart"), baselineFinish: v("baselineFinish") } : {}),
      forecastStart: v("forecastStart"),
      forecastFinish: v("forecastFinish"),
      responsibleId: v("responsibleId"),
      visibleToClient: fd.get("visibleToClient") === "on",
    });
    setBusy(false);
    if (r.ok) {
      form.reset();
      router.refresh();
    } else setError(r.error);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div>
        <Label htmlFor="ms-title">Milestone *</Label>
        <Input id="ms-title" name="title" required maxLength={200} placeholder="e.g., Foundation complete" />
      </div>
      {isOwner ? (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="ms-bs">Baseline start</Label>
            <Input id="ms-bs" name="baselineStart" type="date" />
          </div>
          <div>
            <Label htmlFor="ms-bf">Baseline finish</Label>
            <Input id="ms-bf" name="baselineFinish" type="date" />
          </div>
        </div>
      ) : (
        <p className="text-xs text-ink-500">Only the Owner sets the approved baseline dates. Add forecast dates now; the Owner can set the baseline later.</p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="ms-fs">Forecast start</Label>
          <Input id="ms-fs" name="forecastStart" type="date" />
        </div>
        <div>
          <Label htmlFor="ms-ff">Forecast finish</Label>
          <Input id="ms-ff" name="forecastFinish" type="date" />
        </div>
      </div>
      <div>
        <Label htmlFor="ms-resp">Responsible</Label>
        <Select id="ms-resp" name="responsibleId" defaultValue="">
          <option value="">— unassigned —</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="ms-desc">Description</Label>
        <Textarea id="ms-desc" name="description" rows={2} maxLength={2000} />
      </div>
      <label className="flex items-center gap-2 text-sm text-ink-700">
        <input type="checkbox" name="visibleToClient" defaultChecked className="h-4 w-4" />
        Show to the client in their portal
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? "Saving…" : "Add milestone"}
      </Button>
    </form>
  );
}

export interface EditableMilestone {
  id: string;
  title: string;
  description: string | null;
  status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "BLOCKED";
  baselineStart: string | null;
  baselineFinish: string | null;
  forecastStart: string | null;
  forecastFinish: string | null;
  actualFinish: string | null;
  responsibleId: string | null;
  notes: string | null;
  visibleToClient: boolean;
  revisions: { revision: number; baselineStart: string | null; baselineFinish: string | null; reason: string; by: string; at: string }[];
}

export function MilestoneControls({ m, isOwner, staff }: { m: EditableMilestone; isOwner: boolean; staff: Staff[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<null | "edit" | "baseline" | "history">(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    if (busy) return;
    setBusy(true);
    setError("");
    const r = await fn();
    setBusy(false);
    if (r.ok) {
      setMode(null);
      router.refresh();
    } else setError(r.error);
  }

  function onUpdate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const v = (k: string) => (fd.get(k) as string) || null;
    run(() =>
      send(`/api/milestones/${m.id}`, "PATCH", {
        action: "update",
        title: fd.get("title"),
        description: v("description"),
        status: fd.get("status"),
        forecastStart: v("forecastStart"),
        forecastFinish: v("forecastFinish"),
        actualFinish: v("actualFinish"),
        responsibleId: v("responsibleId"),
        notes: v("notes"),
        visibleToClient: fd.get("visibleToClient") === "on",
      })
    );
  }

  function onBaseline(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    run(() =>
      send(`/api/milestones/${m.id}`, "PATCH", {
        action: "revise_baseline",
        baselineStart: (fd.get("baselineStart") as string) || null,
        baselineFinish: (fd.get("baselineFinish") as string) || null,
        reason: fd.get("reason"),
      })
    );
  }

  const link = "text-xs font-medium text-brand-600 hover:underline";
  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={link} onClick={() => setMode(mode === "edit" ? null : "edit")}>
          Update
        </button>
        {isOwner && (
          <button type="button" className={link} onClick={() => setMode(mode === "baseline" ? null : "baseline")}>
            {m.baselineFinish || m.baselineStart ? "Revise baseline" : "Set baseline"}
          </button>
        )}
        {m.revisions.length > 0 && (
          <button type="button" className={link} onClick={() => setMode(mode === "history" ? null : "history")}>
            Baseline history ({m.revisions.length})
          </button>
        )}
        {isOwner && (
          <button
            type="button"
            className="text-xs font-medium text-red-600 hover:underline"
            onClick={() => {
              if (confirm(`Delete the milestone “${m.title}”? Its baseline history is deleted with it (the audit trail keeps a record).`))
                run(() => send(`/api/milestones/${m.id}`, "DELETE"));
            }}
          >
            Delete
          </button>
        )}
      </div>

      {mode === "edit" && (
        <form onSubmit={onUpdate} className="mt-2 space-y-3 rounded-sm border border-ink-200 bg-ink-100/60 p-3">
          <div>
            <Label htmlFor={`t-${m.id}`}>Milestone</Label>
            <Input id={`t-${m.id}`} name="title" defaultValue={m.title} required maxLength={200} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor={`st-${m.id}`}>Status</Label>
              <Select id={`st-${m.id}`} name="status" defaultValue={m.status}>
                <option value="NOT_STARTED">Not started</option>
                <option value="IN_PROGRESS">In progress</option>
                <option value="BLOCKED">Blocked</option>
                <option value="COMPLETED">Completed</option>
              </Select>
            </div>
            <div>
              <Label htmlFor={`af-${m.id}`}>Actual finish</Label>
              <Input id={`af-${m.id}`} name="actualFinish" type="date" defaultValue={m.actualFinish ?? ""} />
            </div>
            <div>
              <Label htmlFor={`fs-${m.id}`}>Forecast start</Label>
              <Input id={`fs-${m.id}`} name="forecastStart" type="date" defaultValue={m.forecastStart ?? ""} />
            </div>
            <div>
              <Label htmlFor={`ff-${m.id}`}>Forecast finish</Label>
              <Input id={`ff-${m.id}`} name="forecastFinish" type="date" defaultValue={m.forecastFinish ?? ""} />
            </div>
          </div>
          <div>
            <Label htmlFor={`rs-${m.id}`}>Responsible</Label>
            <Select id={`rs-${m.id}`} name="responsibleId" defaultValue={m.responsibleId ?? ""}>
              <option value="">— unassigned —</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor={`ds-${m.id}`}>Description</Label>
            <Textarea id={`ds-${m.id}`} name="description" rows={2} defaultValue={m.description ?? ""} maxLength={2000} />
          </div>
          <div>
            <Label htmlFor={`nt-${m.id}`}>Internal notes (never shown to the client)</Label>
            <Textarea id={`nt-${m.id}`} name="notes" rows={2} defaultValue={m.notes ?? ""} maxLength={2000} />
          </div>
          <label className="flex items-center gap-2 text-sm text-ink-700">
            <input type="checkbox" name="visibleToClient" defaultChecked={m.visibleToClient} className="h-4 w-4" />
            Show to the client
          </label>
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

      {mode === "baseline" && isOwner && (
        <form onSubmit={onBaseline} className="mt-2 space-y-3 rounded-sm border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
          <p className="text-xs text-ink-700">
            The baseline is the approved plan. Revising it keeps the old dates in the history with your reason.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor={`bs-${m.id}`}>Baseline start</Label>
              <Input id={`bs-${m.id}`} name="baselineStart" type="date" defaultValue={m.baselineStart ?? ""} />
            </div>
            <div>
              <Label htmlFor={`bf-${m.id}`}>Baseline finish</Label>
              <Input id={`bf-${m.id}`} name="baselineFinish" type="date" defaultValue={m.baselineFinish ?? ""} />
            </div>
          </div>
          <div>
            <Label htmlFor={`rn-${m.id}`}>Reason *</Label>
            <Input id={`rn-${m.id}`} name="reason" required minLength={5} maxLength={500} placeholder="e.g., Client change order added 12 days" />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy} className="text-xs">
              {busy ? "Saving…" : "Save baseline"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setMode(null)} className="text-xs">
              Cancel
            </Button>
          </div>
        </form>
      )}

      {mode === "history" && (
        <ol className="mt-2 space-y-1.5 rounded-sm border border-ink-200 bg-ink-100/60 p-3 text-xs text-ink-700">
          {m.revisions.map((r) => (
            <li key={r.revision}>
              <strong>Revision {r.revision}</strong> · {r.baselineStart ?? "—"} → {r.baselineFinish ?? "—"} · {r.reason}
              <span className="text-ink-500">
                {" "}
                — {r.by}, {r.at}
              </span>
            </li>
          ))}
        </ol>
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
