"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label, Select } from "@/components/ui";
import { manilaSemiMonthlyPeriod, manilaWeeklySitePeriod } from "@/lib/time-rules";

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

/** Owner-only: delete a generated payroll run from the runs list. */
export function DeleteRunButton({ runId, label, status }: { runId: string; label: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  if (status === "PAID") return null;

  async function remove() {
    const warn =
      status === "APPROVED"
        ? " It is already APPROVED, so its labor cost will also drop out of the reports."
        : "";
    if (!confirm(`Delete the payroll run ${label}?${warn} This can't be undone.`)) return;
    setBusy(true);
    const res = await fetch(`/api/payroll/${runId}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) router.refresh();
    else alert((await res.json()).error ?? "Failed to delete");
  }

  return (
    <button
      type="button"
      onClick={remove}
      disabled={busy}
      className="rounded px-2 py-1 text-xs text-red-500 hover:bg-red-50 disabled:opacity-50"
    >
      {busy ? "…" : "Delete"}
    </button>
  );
}

/**
 * Generate a payroll run for one project (or a department when projectId is
 * absent). Periods are always server-computed, never free-picked — Office/
 * Architect/Engineer run semi-monthly (1st–15th, 16th–end); project crews and
 * Drivers run weekly, Friday 5:01 PM to the next Friday 5:00 PM. Choosing
 * "periods back" only selects WHICH aligned period to generate; it can never
 * produce a misaligned or overlapping one.
 */
type PayrollDepartment = "OFFICE" | "DRIVER" | "ARCHITECT" | "ENGINEER";

export function GenerateRunForm({
  projectId,
  department,
}: {
  projectId?: string;
  department?: PayrollDepartment;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dept, setDept] = useState(department ?? "OFFICE");
  const [periodsBack, setPeriodsBack] = useState(0);

  const isWeekly = !!projectId || dept === "DRIVER";
  const now = new Date();
  const period = isWeekly ? manilaWeeklySitePeriod(now, periodsBack) : manilaSemiMonthlyPeriod(now, periodsBack);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/payroll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        department: projectId ? undefined : dept,
        periodsBack,
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
          <Select
            value={dept}
            onChange={(e) => {
              setDept(e.target.value as PayrollDepartment);
              setPeriodsBack(0);
            }}
          >
            <option value="OFFICE">Office</option>
            <option value="DRIVER">Drivers</option>
            <option value="ARCHITECT">Architects</option>
            <option value="ENGINEER">Engineers</option>
          </Select>
        </div>
      )}
      <div>
        <Label>Pay period</Label>
        <Select value={periodsBack} onChange={(e) => setPeriodsBack(Number(e.target.value))}>
          <option value={0}>Current — {period.label}</option>
          {[1, 2, 3].map((n) => {
            const p = isWeekly ? manilaWeeklySitePeriod(now, n) : manilaSemiMonthlyPeriod(now, n);
            return (
              <option key={n} value={n}>
                {n} period{n > 1 ? "s" : ""} ago — {p.label}
              </option>
            );
          })}
        </Select>
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

  async function cancelApproval() {
    if (!confirm("Cancel the approval and reopen this run for editing?")) return;
    setBusy(true);
    setError("");
    const res = await fetch(`/api/payroll/${runId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "cancel_approval" }),
    });
    setBusy(false);
    if (res.ok) router.refresh();
    else setError((await res.json()).error ?? "Failed");
  }

  async function set(next: string) {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/payroll/${runId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set_status", status: next }),
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
      {status === "APPROVED" && (
        <Button variant="secondary" disabled={busy} onClick={cancelApproval}>
          Cancel approval &amp; edit
        </Button>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
