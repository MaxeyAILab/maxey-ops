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
      <div className="grid gap-3 sm:grid-cols-2">
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
