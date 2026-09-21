"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { submitOrQueue } from "@/lib/outbox";
import { Button, Input, Label, Select, Textarea } from "@/components/ui";
import { PhotoInput } from "@/components/photo-input";
import { NON_PROJECT_INSTRUCTION_CATEGORIES } from "@/lib/instructions";

const CATEGORY_PREFIX = "cat:";

interface ProjectOption {
  id: string;
  name: string;
}

interface EmployeeOption {
  id: string;
  name: string;
  position: string | null;
}

/** Checklist of specific assignees, or broadcast to everyone when none are
 * checked — mutually exclusive with picking people, matching how an
 * unassigned instruction has always meant "whole site team". */
function AssigneeChecklist({
  employees,
  selected,
  onChange,
}: {
  employees: EmployeeOption[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const broadcast = selected.size === 0;
  return (
    <div className="rounded-lg border border-ink-200 bg-ink-50">
      <label className="flex items-center gap-2 border-b border-ink-200 px-3 py-2 text-sm font-medium text-ink-800">
        <input type="checkbox" checked={broadcast} onChange={() => onChange(new Set())} />
        Whole site team (broadcast)
      </label>
      <div className="max-h-40 space-y-0.5 overflow-y-auto px-3 py-1.5">
        {employees.map((e) => (
          <label key={e.id} className="flex items-center gap-2 py-0.5 text-sm text-ink-700">
            <input
              type="checkbox"
              checked={selected.has(e.id)}
              onChange={(ev) => {
                const next = new Set(selected);
                if (ev.target.checked) next.add(e.id);
                else next.delete(e.id);
                onChange(next);
              }}
            />
            {e.name}
            {e.position ? ` — ${e.position}` : ""}
          </label>
        ))}
      </div>
    </div>
  );
}

/** Per-assignee Seen/Unread — only meaningful for specific assignees; a
 * broadcast has no fixed roster to check off, so callers should fall back
 * to the plain "Whole site team" label instead of rendering this. */
export function AssigneeSeenList({
  assignees,
  seenUserIds,
}: {
  assignees: { id: string; name: string }[];
  seenUserIds: string[];
}) {
  const seen = new Set(seenUserIds);
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {assignees.map((a, i) => (
        <span key={a.id} className="inline-flex items-center gap-1">
          {i > 0 && <span className="text-ink-300">,</span>}
          <span className="font-medium text-ink-700">{a.name}</span>
          {seen.has(a.id) ? (
            <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
              Seen
            </span>
          ) : (
            <span className="rounded-full bg-ink-100 px-1.5 py-0.5 text-[10px] font-medium text-ink-500">
              Unread
            </span>
          )}
        </span>
      ))}
    </span>
  );
}

/** Jacob/PM posts a dated assignment — against a project, or a category
 * (office/site/deliveries/warehouse/other) when there's no active project.
 * A Task ID (e.g. OOT-2026-0007, DOT-2026-0007, or {ProjectCode}-2026-0007)
 * is assigned automatically on the server — there's nothing to fill in for it. */
export function PostInstructionForm({
  projects,
  employees,
  postedByName,
}: {
  projects: ProjectOption[];
  employees: EmployeeOption[];
  postedByName: string;
}) {
  const router = useRouter();
  const [photos, setPhotos] = useState<string[]>([]);
  const [assigneeIds, setAssigneeIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const fd = new FormData(e.currentTarget);
    const selection = String(fd.get("projectId") ?? "");
    const isCategory = selection.startsWith(CATEGORY_PREFIX);
    const res = await fetch("/api/instructions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: isCategory ? undefined : selection,
        category: isCategory ? selection.slice(CATEGORY_PREFIX.length) : undefined,
        title: fd.get("title"),
        text: fd.get("text"),
        photos,
        assigneeIds: Array.from(assigneeIds),
        dueDate: fd.get("dueDate") || undefined,
        priority: fd.get("priority") || undefined,
      }),
    });
    setBusy(false);
    if (res.ok) {
      (e.target as HTMLFormElement).reset?.();
      setPhotos([]);
      setAssigneeIds(new Set());
      router.refresh();
    } else {
      setError((await res.json()).error ?? "Failed to post instruction");
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <p className="text-xs text-ink-400">
        Task ID: <span className="font-mono">assigned automatically on posting</span> · Created
        by: <span className="font-medium text-ink-600">{postedByName}</span>
      </p>
      <div>
        <Label htmlFor="insProject">Project</Label>
        <Select id="insProject" name="projectId" defaultValue={`${CATEGORY_PREFIX}OTHER`}>
          <optgroup label="No project">
            {NON_PROJECT_INSTRUCTION_CATEGORIES.map((c) => (
              <option key={c.value} value={`${CATEGORY_PREFIX}${c.value}`}>
                {c.label}
              </option>
            ))}
          </optgroup>
          {projects.length > 0 && (
            <optgroup label="Projects">
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          )}
        </Select>
      </div>
      <div>
        <Label htmlFor="insTitle">Title of task</Label>
        <Input
          id="insTitle"
          name="title"
          required
          maxLength={200}
          placeholder="e.g., Re-check column C4 alignment"
        />
      </div>
      <div>
        <Label htmlFor="insText">Purpose</Label>
        <Textarea
          id="insText"
          name="text"
          rows={3}
          required
          placeholder="What needs to happen and why — e.g., before pouring; use the revised drawing."
        />
      </div>
      <div>
        <Label>Assigned to</Label>
        <AssigneeChecklist employees={employees} selected={assigneeIds} onChange={setAssigneeIds} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="insDue">Date to be completed</Label>
          <Input id="insDue" name="dueDate" type="date" />
        </div>
        <div>
          <Label htmlFor="insPriority">Priority</Label>
          <Select id="insPriority" name="priority" defaultValue="NORMAL">
            {PRIORITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <PhotoInput label="Photo / marked-up drawing (optional)" max={2} onChange={setPhotos} />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" disabled={busy}>
        {busy ? "Posting…" : "Post assignment"}
      </Button>
    </form>
  );
}

const STATUS_OPTIONS = [
  { value: "NOT_STARTED", label: "Not Started" },
  { value: "IN_PROGRESS", label: "In Progress" },
  { value: "ON_HOLD", label: "On Hold" },
  { value: "FOR_REVIEW", label: "For Review" },
  { value: "COMPLETED", label: "Completed" },
  { value: "CANCELLED", label: "Cancelled" },
];

const PRIORITY_OPTIONS = [
  { value: "LOW", label: "Low" },
  { value: "NORMAL", label: "Normal" },
  { value: "HIGH", label: "High" },
  { value: "CRITICAL", label: "Critical" },
];

/** Assignee (or PM/Owner) updates status + a progress remark — offline-capable. */
export function InstructionUpdateForm({
  instructionId,
  status,
  remarks,
}: {
  instructionId: string;
  status: string;
  remarks: string | null;
}) {
  const router = useRouter();
  const [nextStatus, setNextStatus] = useState(status);
  const [nextRemarks, setNextRemarks] = useState(remarks ?? "");
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState(false);

  const dirty = nextStatus !== status || nextRemarks !== (remarks ?? "");

  async function save() {
    setBusy(true);
    const result = await submitOrQueue({
      url: `/api/instructions/${instructionId}`,
      method: "PATCH",
      label: "Assignment update",
      body: { action: "update_status", status: nextStatus, remarks: nextRemarks },
    });
    setBusy(false);
    if (result.queued) setQueued(true);
    else router.refresh();
  }

  if (queued) {
    return <span className="text-xs text-amber-600">Saved offline — will sync</span>;
  }

  return (
    <div className="space-y-2 rounded-lg border border-ink-100 bg-ink-50/50 p-3">
      <div>
        <Label htmlFor={`status-${instructionId}`}>Status</Label>
        <Select
          id={`status-${instructionId}`}
          value={nextStatus}
          onChange={(e) => setNextStatus(e.target.value)}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor={`remarks-${instructionId}`}>Remarks / progress update</Label>
        <Textarea
          id={`remarks-${instructionId}`}
          rows={2}
          value={nextRemarks}
          onChange={(e) => setNextRemarks(e.target.value)}
          placeholder="What's done, what's left, any blockers…"
        />
      </div>
      <Button
        variant="secondary"
        disabled={busy || !dirty}
        onClick={save}
        className="min-h-[36px] px-3 text-xs"
      >
        {busy ? "Saving…" : "Save update"}
      </Button>
    </div>
  );
}

const APPROVAL_OPTIONS = [
  { value: "APPROVED", label: "✓ Approved" },
  { value: "NEEDS_REVISION", label: "↩ Needs revision" },
];

/** Owner/PM reviews a completed (or in-review) assignment — independent of status. */
export function InstructionReviewForm({
  instructionId,
  approval,
  supervisorRemarks,
}: {
  instructionId: string;
  approval: string;
  supervisorRemarks: string | null;
}) {
  const router = useRouter();
  const [nextApproval, setNextApproval] = useState(approval === "PENDING" ? "APPROVED" : approval);
  const [nextRemarks, setNextRemarks] = useState(supervisorRemarks ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const res = await fetch(`/api/instructions/${instructionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "review", approval: nextApproval, supervisorRemarks: nextRemarks }),
    });
    setBusy(false);
    if (res.ok) router.refresh();
  }

  return (
    <div className="space-y-2 rounded-lg border border-brand-100 bg-brand-50/40 p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-brand-700">
        Supervisor review
      </div>
      <div>
        <Label htmlFor={`approval-${instructionId}`}>Approval</Label>
        <Select
          id={`approval-${instructionId}`}
          value={nextApproval}
          onChange={(e) => setNextApproval(e.target.value)}
        >
          {APPROVAL_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor={`supRemarks-${instructionId}`}>Supervisor remarks</Label>
        <Textarea
          id={`supRemarks-${instructionId}`}
          rows={2}
          value={nextRemarks}
          onChange={(e) => setNextRemarks(e.target.value)}
          placeholder="Feedback for the assignee…"
        />
      </div>
      <Button variant="secondary" disabled={busy} onClick={save} className="min-h-[36px] px-3 text-xs">
        {busy ? "Saving…" : "Save review"}
      </Button>
    </div>
  );
}

// Tailwind classes (not inline hex) so these pills pick up a dark: variant
// like Badge's tones do, instead of staying a fixed light color always.
const STATUS_CELL_COLORS: Record<string, string> = {
  NOT_STARTED: "bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-300",
  IN_PROGRESS: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  ON_HOLD: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  FOR_REVIEW: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
  COMPLETED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  CANCELLED: "bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-300",
};

const PRIORITY_CELL_COLORS: Record<string, string> = {
  LOW: "bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-300",
  NORMAL: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  HIGH: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  CRITICAL: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

const pillSelectClass =
  "min-h-0 w-full appearance-none rounded-md border-0 px-2 py-1 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-60";

/** Board-view status cell — auto-saves on change, colored like a Monday.com
 * status pill. Never touches remarks (omits the field so the API leaves it
 * untouched), so switching status here can't wipe a progress note entered
 * elsewhere. */
export function BoardStatusCell({
  instructionId,
  status,
  canUpdate,
}: {
  instructionId: string;
  status: string;
  canUpdate: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(status);
  const [busy, setBusy] = useState(false);
  const tone = STATUS_CELL_COLORS[value] ?? STATUS_CELL_COLORS.NOT_STARTED;

  if (!canUpdate) {
    return (
      <span className={`inline-block rounded-md px-2 py-1 text-xs font-medium ${tone}`}>
        {STATUS_OPTIONS.find((o) => o.value === value)?.label ?? value}
      </span>
    );
  }

  async function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value;
    setValue(next);
    setBusy(true);
    await fetch(`/api/instructions/${instructionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update_status", status: next }),
    });
    setBusy(false);
    router.refresh();
  }

  return (
    <select
      value={value}
      onChange={onChange}
      disabled={busy}
      className={`${pillSelectClass} ${tone}`}
    >
      {STATUS_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Board-view priority cell — Owner/PM only, auto-saves on change. */
export function BoardPriorityCell({
  instructionId,
  priority,
  canEdit,
}: {
  instructionId: string;
  priority: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(priority);
  const [busy, setBusy] = useState(false);
  const tone = PRIORITY_CELL_COLORS[value] ?? PRIORITY_CELL_COLORS.NORMAL;

  if (!canEdit) {
    return (
      <span className={`inline-block rounded-md px-2 py-1 text-xs font-medium ${tone}`}>
        {PRIORITY_OPTIONS.find((o) => o.value === value)?.label ?? value}
      </span>
    );
  }

  async function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value;
    setValue(next);
    setBusy(true);
    await fetch(`/api/instructions/${instructionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set_priority", priority: next }),
    });
    setBusy(false);
    router.refresh();
  }

  return (
    <select
      value={value}
      onChange={onChange}
      disabled={busy}
      className={`${pillSelectClass} ${tone}`}
    >
      {PRIORITY_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

interface InstructionEditable {
  id: string;
  taskId: string | null;
  title: string | null;
  text: string;
  projectId: string | null;
  category: string | null;
  assigneeIds: string[];
  dueDate: string | null; // yyyy-mm-dd, or "" if unset
}

/** Owner/PM edits an assignment's core content (job, project/category,
 * assignee, target date) — separate from status/priority, which anyone
 * authorized can change without touching what was actually assigned. */
export function EditInstructionForm({
  instruction,
  projects,
  employees,
}: {
  instruction: InstructionEditable;
  projects: ProjectOption[];
  employees: EmployeeOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [assigneeIds, setAssigneeIds] = useState<Set<string>>(new Set(instruction.assigneeIds));

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const fd = new FormData(e.currentTarget);
    const selection = String(fd.get("projectId") ?? "");
    const isCategory = selection.startsWith(CATEGORY_PREFIX);
    const res = await fetch(`/api/instructions/${instruction.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "edit",
        title: fd.get("title"),
        text: fd.get("text"),
        projectId: isCategory ? undefined : selection,
        category: isCategory ? selection.slice(CATEGORY_PREFIX.length) : undefined,
        assigneeIds: Array.from(assigneeIds),
        dueDate: fd.get("dueDate") || null,
      }),
    });
    setBusy(false);
    if (res.ok) {
      setOpen(false);
      router.refresh();
    } else {
      setError((await res.json()).error ?? "Failed to save changes");
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-medium text-brand-600 hover:underline"
      >
        Edit
      </button>
    );
  }

  const currentSelection = instruction.projectId ?? `${CATEGORY_PREFIX}${instruction.category ?? "OTHER"}`;

  return (
    <form
      onSubmit={onSubmit}
      className="mt-2 space-y-3 rounded-lg border border-brand-100 bg-brand-50/40 p-3"
    >
      {instruction.taskId && (
        <p className="font-mono text-xs text-ink-500">Task ID: {instruction.taskId}</p>
      )}
      <div>
        <Label htmlFor={`eiProject-${instruction.id}`}>Project</Label>
        <Select id={`eiProject-${instruction.id}`} name="projectId" defaultValue={currentSelection}>
          <optgroup label="No project">
            {NON_PROJECT_INSTRUCTION_CATEGORIES.map((c) => (
              <option key={c.value} value={`${CATEGORY_PREFIX}${c.value}`}>
                {c.label}
              </option>
            ))}
          </optgroup>
          {projects.length > 0 && (
            <optgroup label="Projects">
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          )}
        </Select>
      </div>
      <div>
        <Label htmlFor={`eiTitle-${instruction.id}`}>Title of task</Label>
        <Input
          id={`eiTitle-${instruction.id}`}
          name="title"
          required
          maxLength={200}
          defaultValue={instruction.title ?? ""}
        />
      </div>
      <div>
        <Label htmlFor={`eiText-${instruction.id}`}>Purpose</Label>
        <Textarea id={`eiText-${instruction.id}`} name="text" rows={3} required defaultValue={instruction.text} />
      </div>
      <div>
        <Label>Assigned to</Label>
        <AssigneeChecklist employees={employees} selected={assigneeIds} onChange={setAssigneeIds} />
      </div>
      <div>
        <Label htmlFor={`eiDue-${instruction.id}`}>Date to be completed</Label>
        <Input
          id={`eiDue-${instruction.id}`}
          name="dueDate"
          type="date"
          defaultValue={instruction.dueDate ?? ""}
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => setOpen(false)} className="text-xs">
          Cancel
        </Button>
        <Button type="submit" disabled={busy} className="text-xs">
          {busy ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

/** Owner-only cleanup for a test/mistaken assignment. */
export function DeleteInstructionButton({ instructionId }: { instructionId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onDelete() {
    if (!confirm("Delete this assignment? This cannot be undone.")) return;
    setBusy(true);
    const res = await fetch(`/api/instructions/${instructionId}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) {
      router.refresh();
    } else {
      alert((await res.json()).error ?? "Failed to delete");
    }
  }

  return (
    <button
      type="button"
      onClick={onDelete}
      disabled={busy}
      className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
    >
      {busy ? "Deleting…" : "Delete"}
    </button>
  );
}
