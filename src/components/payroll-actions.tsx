"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label, Select } from "@/components/ui";
import { Modal } from "@/components/modal";
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

interface HoursChange {
  userId: string;
  name: string;
  before: { regularHours: number; otHours: number; gross: number; net: number };
  after: { regularHours: number; otHours: number; gross: number; net: number };
}

const money = (n: number) => `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const hrs = (n: number) => (Math.round(n * 100) / 100).toString();

/**
 * "Recalculate hours" on a draft run: re-reads each worker's hours from the attendance records — for when overtime or early-start
 * hours were approved or changed after the run was generated. It first shows what would change; nothing is saved until Apply.
 * Rates, meals, cash advances and anyone added by hand stay as they are.
 */
export function RecalculateHoursButton({ runId }: { runId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<{ changes: HoursChange[]; notOnRun: string[] } | null>(null);

  async function call(apply: boolean) {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/payroll/${runId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "recalculate_hours", apply }) });
    setBusy(false);
    if (!res.ok) return setError(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Failed");
    const data = (await res.json()) as { changes: HoursChange[]; notOnRun: string[] };
    if (apply) {
      setPreview(null);
      router.refresh();
    } else setPreview(data);
  }

  return (
    <>
      <Button variant="secondary" disabled={busy} onClick={() => call(false)}>
        {busy && !preview ? "Checking…" : "↻ Recalculate hours"}
      </Button>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {preview && (
        <Modal title="Recalculate hours from attendance" onClose={() => setPreview(null)} wide>
          <div className="space-y-3 text-sm">
            {preview.changes.length === 0 ? (
              <p className="rounded-md bg-emerald-50 px-3 py-2 text-emerald-900">The hours on this run already match the attendance records and approvals — nothing to change.</p>
            ) : (
              <>
                <p className="text-ink-700">These workers&apos; hours will be re-read from the attendance records and overtime approvals. Nothing is saved until you press Apply.</p>
                <div className="overflow-x-auto rounded-lg border border-ink-200">
                  <table className="w-full min-w-[460px] text-left">
                    <thead className="bg-ink-100 text-xs uppercase tracking-wide text-ink-600">
                      <tr>
                        <th className="px-3 py-2">Worker</th>
                        <th className="px-3 py-2 text-right">Regular h</th>
                        <th className="px-3 py-2 text-right">OT h</th>
                        <th className="px-3 py-2 text-right">Net pay</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.changes.map((c) => (
                        <tr key={c.userId} className="border-t border-ink-100">
                          <td className="px-3 py-2 font-medium text-ink-900">{c.name}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {hrs(c.before.regularHours)} → <b>{hrs(c.after.regularHours)}</b>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {hrs(c.before.otHours)} → <b>{hrs(c.after.otHours)}</b>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {money(c.before.net)} → <b>{money(c.after.net)}</b>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-ink-500">Rates, meals, cash advances and anyone you added by hand stay as they are. SSS and PhilHealth follow the new pay unless you typed them in yourself. If you edited a worker&apos;s hours by hand, those are replaced by the attendance records.</p>
              </>
            )}
            {preview.notOnRun.length > 0 && <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">Also has attendance in this period but is not on the run (not added automatically): {preview.notOnRun.join(", ")}.</p>}
            <div className="flex gap-2">
              {preview.changes.length > 0 && (
                <Button disabled={busy} onClick={() => call(true)}>
                  {busy ? "Applying…" : "Apply"}
                </Button>
              )}
              <Button variant="secondary" onClick={() => setPreview(null)}>
                {preview.changes.length > 0 ? "Cancel" : "Close"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
