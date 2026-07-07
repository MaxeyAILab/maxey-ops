"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label, Select } from "@/components/ui";

interface EmployeeOption {
  id: string;
  name: string;
}

/** "Add employee" to a project's payroll roster (start date + rate/hr). */
export function AddEmployeeForm({
  projectId,
  employees,
}: {
  projectId: string;
  employees: EmployeeOption[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const fd = new FormData(e.currentTarget);
    const res = await fetch("/api/assignments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        userId: fd.get("userId"),
        startDate: fd.get("startDate"),
        hourlyRate: fd.get("hourlyRate"),
      }),
    });
    setBusy(false);
    if (res.ok) {
      (e.target as HTMLFormElement).reset?.();
      router.refresh();
    } else {
      setError((await res.json()).error ?? "Failed to add employee");
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-4">
      <div>
        <Label>Employee</Label>
        <Select name="userId" required>
          {employees.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label>Started on project</Label>
        <Input
          name="startDate"
          type="date"
          required
          defaultValue={new Date().toISOString().slice(0, 10)}
        />
      </div>
      <div>
        <Label>Rate per hour (PHP)</Label>
        <Input name="hourlyRate" type="number" min="1" step="0.01" required placeholder="e.g., 100" />
      </div>
      <div className="flex items-end">
        <Button type="submit" variant="secondary" disabled={busy || employees.length === 0} className="w-full">
          {busy ? "Adding…" : "+ Add employee"}
        </Button>
      </div>
      {error && <p className="text-sm text-red-600 sm:col-span-4">{error}</p>}
    </form>
  );
}

/** Remove an employee from the roster (history kept). */
export function RemoveEmployeeButton({ assignmentId, name }: { assignmentId: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (!confirm(`Remove ${name} from this project's payroll roster?`)) return;
    setBusy(true);
    await fetch(`/api/assignments/${assignmentId}`, { method: "DELETE" });
    setBusy(false);
    router.refresh();
  }

  return (
    <button
      onClick={remove}
      disabled={busy}
      className="rounded px-2 py-1 text-xs text-red-500 hover:bg-red-50 disabled:opacity-50"
    >
      {busy ? "…" : "Remove"}
    </button>
  );
}

/** Generate a payroll run for one project (or a department when projectId is absent). */
export function GenerateRunForm({
  projectId,
  department,
}: {
  projectId?: string;
  department?: "OFFICE" | "DRIVER";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dept, setDept] = useState(department ?? "OFFICE");

  const end = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const fd = new FormData(e.currentTarget);
    const res = await fetch("/api/payroll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        department: projectId ? undefined : dept,
        periodStart: fd.get("periodStart"),
        periodEnd: fd.get("periodEnd"),
      }),
    });
    setBusy(false);
    if (res.ok) {
      const run = await res.json();
      router.push(`/payroll/${run.id}`);
    } else {
      setError((await res.json()).error ?? "Failed to generate run");
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
      {!projectId && (
        <div>
          <Label>Department</Label>
          <Select value={dept} onChange={(e) => setDept(e.target.value as "OFFICE" | "DRIVER")}>
            <option value="OFFICE">Office</option>
            <option value="DRIVER">Drivers</option>
          </Select>
        </div>
      )}
      <div>
        <Label>From</Label>
        <Input name="periodStart" type="date" defaultValue={start} required />
      </div>
      <div>
        <Label>To</Label>
        <Input name="periodEnd" type="date" defaultValue={end} required />
      </div>
      <Button type="submit" disabled={busy}>
        {busy ? "Computing…" : "Generate payroll"}
      </Button>
      {error && <p className="w-full text-sm text-red-600">{error}</p>}
    </form>
  );
}

/** Move a run through DRAFT → REVIEW → APPROVED → PAID. */
export function PayrollStatusButtons({ runId, status }: { runId: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function set(next: string) {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/payroll/${runId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    setBusy(false);
    if (res.ok) router.refresh();
    else setError((await res.json()).error ?? "Failed");
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "DRAFT" && (
        <Button variant="secondary" disabled={busy} onClick={() => set("REVIEW")}>
          Submit for review
        </Button>
      )}
      {(status === "DRAFT" || status === "REVIEW") && (
        <Button variant="success" disabled={busy} onClick={() => set("APPROVED")}>
          ✓ Approve (Owner)
        </Button>
      )}
      {status === "APPROVED" && (
        <Button disabled={busy} onClick={() => set("PAID")}>
          Mark as paid
        </Button>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
