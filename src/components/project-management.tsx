"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardBody, CardHeader, Input, Label } from "@/components/ui";
import {
  COMPLETED_STATUSES,
  ONGOING_STATUSES,
  PROSPECTIVE_STATUSES,
  STATUS_LABELS,
} from "@/lib/project-status";

/** Manual "+ Add project" form on the Projects tab. */
export function AddProjectForm({ onDone }: { onDone?: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const fd = new FormData(e.currentTarget);
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: fd.get("name"),
        address: fd.get("address"),
        ownerName: fd.get("ownerName"),
        contractValue: fd.get("contractValue"),
        startDate: fd.get("startDate") || undefined,
      }),
    });
    setBusy(false);
    if (res.ok) {
      (e.target as HTMLFormElement).reset?.();
      onDone?.();
      router.refresh();
    } else {
      setError((await res.json()).error ?? "Failed to add project");
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="pjName">Project title *</Label>
          <Input id="pjName" name="name" required placeholder="e.g., Santos Warehouse" />
        </div>
        <div>
          <Label htmlFor="pjOwner">Project owner *</Label>
          <Input id="pjOwner" name="ownerName" required placeholder="Client / company name" />
        </div>
      </div>
      <div>
        <Label htmlFor="pjAddress">Project address</Label>
        <Input id="pjAddress" name="address" placeholder="Street, barangay, city, province" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="pjValue">Total contract value (PHP) *</Label>
          <Input id="pjValue" name="contractValue" type="number" min="0" step="0.01" required />
        </div>
        <div>
          <Label htmlFor="pjStart">Start date</Label>
          <Input id="pjStart" name="startDate" type="date" />
        </div>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" disabled={busy}>
        {busy ? "Adding…" : "Add project"}
      </Button>
      <p className="text-xs text-ink-400">
        New projects start under Prospective as “For Site Survey” — change the status from the
        dropdown once work begins.
      </p>
    </form>
  );
}

/** Toggleable wrapper so the form only shows when needed. */
export function AddProjectSection() {
  const [open, setOpen] = useState(false);
  if (!open) {
    return <Button onClick={() => setOpen(true)}>+ Add project</Button>;
  }
  return (
    <Card className="w-full">
      <CardHeader
        title="Add a project manually"
        action={
          <button onClick={() => setOpen(false)} className="text-sm text-ink-400 hover:text-ink-600">
            ✕ Close
          </button>
        }
      />
      <CardBody>
        <AddProjectForm onDone={() => setOpen(false)} />
      </CardBody>
    </Card>
  );
}

/** Per-row lifecycle dropdown. TURNED_OVER moves the project to Completed. */
export function ProjectStatusSelect({
  projectId,
  current,
}: {
  projectId: string;
  current: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function change(status: string) {
    if (
      status === "TURNED_OVER" &&
      !confirm("Mark this project as Turned-over? It will move to Completed/Turn-over Projects.")
    ) {
      return;
    }
    setBusy(true);
    const res = await fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    // Turnover housekeeping: offer to close portal access when the client has
    // no other running projects (accounts are deactivated, never deleted).
    if (res.ok) {
      const data = await res.json();
      const s = data.portalSuggestion;
      if (
        s?.users?.length &&
        confirm(
          `${s.clientName} has no other active projects. Deactivate their client portal access now? Their approval history is kept and access can be restored anytime from the People page.`
        )
      ) {
        for (const u of s.users) {
          await fetch(`/api/people/${u.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "deactivate" }),
          });
        }
      }
    }
    setBusy(false);
    router.refresh();
  }

  return (
    <select
      value={current}
      disabled={busy}
      onChange={(e) => change(e.target.value)}
      className="min-h-[38px] rounded-lg border border-ink-200 bg-white px-2 text-xs font-medium text-ink-700 focus:border-brand-500 focus:outline-none"
    >
      <optgroup label="Prospective">
        {PROSPECTIVE_STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABELS[s]}
          </option>
        ))}
      </optgroup>
      <optgroup label="On-going">
        {ONGOING_STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABELS[s]}
          </option>
        ))}
      </optgroup>
      <optgroup label="Completed">
        {COMPLETED_STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABELS[s]}
          </option>
        ))}
      </optgroup>
    </select>
  );
}

const RELATED_LABELS: Record<string, string> = {
  requisitions: "requisition(s)",
  purchaseOrders: "purchase order(s)",
  deliveries: "delivery record(s)",
  payments: "payment record(s)",
  changeOrders: "change order(s)",
  progressEntries: "progress update(s)",
  instructions: "site instruction(s) / assignment(s)",
  meetings: "meeting log(s)",
  logbookEntries: "logbook entry(ies)",
  tripLogs: "trip log(s)",
  attendance: "attendance record(s)",
  assignments: "project assignment(s)",
  payrollRuns: "payroll run(s)",
  materialStocks: "on-site material stock row(s)",
};

/** Owner-only cleanup for a mistaken/duplicate project. Plain delete succeeds
 * instantly if nothing is attached; otherwise shows exactly what's attached
 * and requires typing the project name before a force delete cascades
 * through it all. */
export function DeleteProjectButton({ projectId, name }: { projectId: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [confirmText, setConfirmText] = useState("");

  async function attemptDelete(force: boolean) {
    setBusy(true);
    const res = await fetch(`/api/projects/${projectId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force }),
    });
    setBusy(false);
    if (res.ok) {
      setCounts(null);
      router.refresh();
      return;
    }
    const data = await res.json().catch(() => ({}));
    if (data.blocked && data.counts) {
      setCounts(data.counts);
    } else {
      alert(data.error ?? "Failed to delete");
    }
  }

  function onDeleteClick() {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    attemptDelete(false);
  }

  if (counts) {
    const lines = Object.entries(counts).filter(([, n]) => n > 0);
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        onClick={() => setCounts(null)}
      >
        <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md">
          <Card>
            <CardHeader
              title={`Force delete "${name}"?`}
              subtitle="This permanently deletes the project AND everything below — no undo."
            />
            <CardBody className="space-y-3">
              <ul className="list-disc space-y-1 pl-5 text-sm text-ink-700">
                {lines.map(([key, n]) => (
                  <li key={key}>
                    {n} {RELATED_LABELS[key] ?? key}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-ink-500">
                Equipment/inventory movement history that merely references this project is kept
                and unlinked, not deleted.
              </p>
              <div>
                <Label htmlFor={`confirmName-${projectId}`}>Type the project name to confirm</Label>
                <Input
                  id={`confirmName-${projectId}`}
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder={name}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setCounts(null)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  disabled={busy || confirmText !== name}
                  onClick={() => attemptDelete(true)}
                >
                  {busy ? "Deleting…" : "Force delete everything"}
                </Button>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onDeleteClick}
      disabled={busy}
      className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
    >
      {busy ? "Deleting…" : "Delete"}
    </button>
  );
}
