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

/** Jacob/PM posts a dated assignment — against a project, or a category
 * (office/site/deliveries/warehouse/other) when there's no active project. */
export function PostInstructionForm({
  projects,
  employees,
}: {
  projects: ProjectOption[];
  employees: EmployeeOption[];
}) {
  const router = useRouter();
  const [photos, setPhotos] = useState<string[]>([]);
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
        text: fd.get("text"),
        photos,
        assignedToId: fd.get("assignedToId") || undefined,
        dueDate: fd.get("dueDate") || undefined,
        priority: fd.get("priority") || undefined,
      }),
    });
    setBusy(false);
    if (res.ok) {
      (e.target as HTMLFormElement).reset?.();
      setPhotos([]);
      router.refresh();
    } else {
      setError((await res.json()).error ?? "Failed to post instruction");
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
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
        <Label htmlFor="insText">Assignment / job</Label>
        <Textarea
          id="insText"
          name="text"
          rows={3}
          required
          placeholder="e.g., Re-check column C4 alignment before pouring; use the revised drawing."
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="insAssignee">Assigned to</Label>
          <Select id="insAssignee" name="assignedToId" defaultValue="">
            <option value="">Whole site team (broadcast)</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
                {e.position ? ` — ${e.position}` : ""}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="insDue">Target completion date</Label>
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

const STATUS_CELL_COLORS: Record<string, { bg: string; text: string }> = {
  NOT_STARTED: { bg: "#f1f5f9", text: "#475569" },
  IN_PROGRESS: { bg: "#dbeafe", text: "#1e40af" },
  ON_HOLD: { bg: "#fef3c7", text: "#92400e" },
  FOR_REVIEW: { bg: "#ede9fe", text: "#5b21b6" },
  COMPLETED: { bg: "#d1fae5", text: "#065f46" },
  CANCELLED: { bg: "#f1f5f9", text: "#475569" },
};

const PRIORITY_CELL_COLORS: Record<string, { bg: string; text: string }> = {
  LOW: { bg: "#f1f5f9", text: "#475569" },
  NORMAL: { bg: "#dbeafe", text: "#1e40af" },
  HIGH: { bg: "#fef3c7", text: "#92400e" },
  CRITICAL: { bg: "#fee2e2", text: "#991b1b" },
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
      <span
        className="inline-block rounded-md px-2 py-1 text-xs font-medium"
        style={{ backgroundColor: tone.bg, color: tone.text }}
      >
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
      style={{ backgroundColor: tone.bg, color: tone.text }}
      className={pillSelectClass}
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
      <span
        className="inline-block rounded-md px-2 py-1 text-xs font-medium"
        style={{ backgroundColor: tone.bg, color: tone.text }}
      >
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
      style={{ backgroundColor: tone.bg, color: tone.text }}
      className={pillSelectClass}
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
  text: string;
  projectId: string | null;
  category: string | null;
  assignedToId: string | null;
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
        text: fd.get("text"),
        projectId: isCategory ? undefined : selection,
        category: isCategory ? selection.slice(CATEGORY_PREFIX.length) : undefined,
        assignedToId: fd.get("assignedToId") || undefined,
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
        <Label htmlFor={`eiText-${instruction.id}`}>Assignment / job</Label>
        <Textarea id={`eiText-${instruction.id}`} name="text" rows={3} required defaultValue={instruction.text} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`eiAssignee-${instruction.id}`}>Assigned to</Label>
          <Select
            id={`eiAssignee-${instruction.id}`}
            name="assignedToId"
            defaultValue={instruction.assignedToId ?? ""}
          >
            <option value="">Whole site team (broadcast)</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
                {e.position ? ` — ${e.position}` : ""}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor={`eiDue-${instruction.id}`}>Target completion date</Label>
          <Input
            id={`eiDue-${instruction.id}`}
            name="dueDate"
            type="date"
            defaultValue={instruction.dueDate ?? ""}
          />
        </div>
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
