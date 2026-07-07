"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardBody, CardHeader, Input, Label } from "@/components/ui";
import { ALL_STATUSES, STATUS_LABELS } from "@/lib/project-status";

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
      {ALL_STATUSES.map((s) => (
        <option key={s} value={s}>
          {STATUS_LABELS[s]}
        </option>
      ))}
    </select>
  );
}
