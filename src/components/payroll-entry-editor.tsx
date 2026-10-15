"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { PAYROLL_CONFIG, type PayrollEntry } from "@/lib/payroll";
import { php } from "@/lib/format";

type EditableField = "regularHours" | "otHours" | "hourlyRate" | "sss" | "philhealth" | "pagibig" | "meals" | "cashAdvance";

function computeGross(e: Pick<PayrollEntry, "regularHours" | "otHours" | "hourlyRate">): number {
  return e.regularHours * e.hourlyRate + e.otHours * e.hourlyRate * PAYROLL_CONFIG.otMultiplier;
}
function computeNet(e: PayrollEntry): number {
  const gross = computeGross(e);
  return Math.max(0, gross - e.sss - e.philhealth - e.pagibig - e.meals - e.cashAdvance);
}

/**
 * Owner/PM editable payroll register — hours, rate, and every deduction are
 * live inputs; gross and net recompute on every keystroke so what's on
 * screen always matches what "Save changes" will store. Only available while
 * the run is DRAFT/REVIEW (the API enforces this too — this is just the UI
 * reflecting the same rule).
 */
export function EditablePayrollTable({ runId, initialEntries }: { runId: string; initialEntries: PayrollEntry[] }) {
  const router = useRouter();
  const [entries, setEntries] = useState<PayrollEntry[]>(initialEntries);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  function update(userId: string, field: EditableField, value: number) {
    setSaved(false);
    setEntries((prev) => prev.map((e) => (e.userId === userId ? { ...e, [field]: value } : e)));
  }

  async function onSave() {
    setBusy(true);
    setError("");
    setSaved(false);
    const res = await fetch(`/api/payroll/${runId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "update_entries",
        entries: entries.map((e) => ({
          userId: e.userId,
          regularHours: e.regularHours,
          otHours: e.otHours,
          hourlyRate: e.hourlyRate,
          sss: e.sss,
          philhealth: e.philhealth,
          pagibig: e.pagibig,
          meals: e.meals,
          cashAdvance: e.cashAdvance,
        })),
      }),
    });
    setBusy(false);
    if (res.ok) {
      setSaved(true);
      router.refresh();
    } else {
      setError((await res.json()).error ?? "Failed to save changes");
    }
  }

  const totals = entries.reduce(
    (acc, e) => ({
      gross: acc.gross + computeGross(e),
      deductions: acc.deductions + e.sss + e.philhealth + e.pagibig + e.meals + e.cashAdvance,
      net: acc.net + computeNet(e),
    }),
    { gross: 0, deductions: 0, net: 0 }
  );

  const cell = "w-20 rounded border border-ink-200 bg-ink-50 px-1.5 py-1 text-right text-xs tabular-nums focus:border-brand-500 focus:outline-none";

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-xs font-semibold uppercase tracking-wide text-ink-500">
              <th className="border-b border-ink-100 px-2 py-2">Worker</th>
              <th className="border-b border-ink-100 px-2 py-2 text-right">Days</th>
              <th className="border-b border-ink-100 px-2 py-2 text-right">Reg hrs</th>
              <th className="border-b border-ink-100 px-2 py-2 text-right">OT hrs</th>
              <th className="border-b border-ink-100 px-2 py-2 text-right">Rate/hr</th>
              <th className="border-b border-ink-100 px-2 py-2 text-right">Gross</th>
              <th className="border-b border-ink-100 px-2 py-2 text-right">SSS</th>
              <th className="border-b border-ink-100 px-2 py-2 text-right">PhilHealth</th>
              <th className="border-b border-ink-100 px-2 py-2 text-right">Pag-IBIG</th>
              <th className="border-b border-ink-100 px-2 py-2 text-right">Meals</th>
              <th className="border-b border-ink-100 px-2 py-2 text-right">Cash adv.</th>
              <th className="border-b border-ink-100 px-2 py-2 text-right">Net pay</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.userId} className="border-b border-ink-50">
                <td className="px-2 py-1.5 font-medium">
                  {e.name}
                  {e.manual && <span className="ml-1.5 rounded-sm bg-ink-200 px-1 py-0.5 text-[10px] font-semibold text-ink-600">added by hand</span>}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-ink-500">{e.daysWorked}</td>
                {(["regularHours", "otHours", "hourlyRate"] as const).map((field) => (
                  <td key={field} className="px-2 py-1.5">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={e[field]}
                      onChange={(ev) => update(e.userId, field, Number(ev.target.value))}
                      className={cell}
                    />
                  </td>
                ))}
                <td className="px-2 py-1.5 text-right font-medium tabular-nums">{php(computeGross(e))}</td>
                {(["sss", "philhealth", "pagibig", "meals", "cashAdvance"] as const).map((field) => (
                  <td key={field} className="px-2 py-1.5">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={e[field]}
                      onChange={(ev) => update(e.userId, field, Number(ev.target.value))}
                      className={cell}
                    />
                  </td>
                ))}
                <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-emerald-700">
                  {php(computeNet(e))}
                </td>
              </tr>
            ))}
            <tr className="bg-ink-50 font-semibold">
              <td className="px-2 py-2" colSpan={5}>
                TOTAL ({entries.length} workers)
              </td>
              <td className="px-2 py-2 text-right tabular-nums">{php(totals.gross)}</td>
              <td className="px-2 py-2 text-right tabular-nums text-ink-500" colSpan={5}>
                {php(totals.deductions)}
              </td>
              <td className="px-2 py-2 text-right tabular-nums text-emerald-700">{php(totals.net)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3">
        <Button type="button" disabled={busy} onClick={onSave}>
          {busy ? "Saving…" : "Save changes"}
        </Button>
        {saved && <span className="text-sm text-emerald-600">Saved.</span>}
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
    </div>
  );
}

export interface AddPersonCandidate {
  id: string;
  name: string;
  /** Hourly rate worked out from their profile, or null when none is set. */
  rate: number | null;
}

/**
 * Owner/PM: put someone on this run who isn't on it — for example the Owner, who doesn't clock in. The hours start
 * at a full period of working days (Monday–Saturday × 8) and the rate comes from their profile; both can be changed
 * here, and everything can still be edited in the register afterwards. Only while the run is a draft or in review.
 */
export function AddPersonToRun({ runId, candidates, defaultHours, workingDays }: { runId: string; candidates: AddPersonCandidate[]; defaultHours: number; workingDays: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [userId, setUserId] = useState(candidates[0]?.id ?? "");
  const chosen = candidates.find((c) => c.id === userId);

  if (candidates.length === 0) return null;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const fd = new FormData(e.currentTarget);
    const rate = fd.get("rate");
    const res = await fetch(`/api/payroll/${runId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add_person", userId, regularHours: fd.get("hours"), ...(rate ? { hourlyRate: rate } : {}) }),
    });
    setBusy(false);
    if (res.ok) router.refresh();
    else setError(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Could not add the person");
  }

  return (
    <details className="rounded-lg border border-dashed border-ink-200 p-3">
      <summary className="cursor-pointer text-sm font-medium text-ink-700">+ Add a person to this run</summary>
      <form onSubmit={onSubmit} className="mt-3 space-y-3">
        <p className="text-xs text-ink-500">
          For someone who isn&apos;t on the run because they didn&apos;t clock in. Save any edits in the table above first — adding a person reloads it.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="ap-person" className="mb-1 block text-xs font-medium text-ink-700">Person</label>
            <select id="ap-person" value={userId} onChange={(ev) => setUserId(ev.target.value)} className="block min-h-[40px] w-full rounded-lg border border-ink-200 bg-ink-50 px-2 text-sm">
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="ap-hours" className="mb-1 block text-xs font-medium text-ink-700">Regular hours</label>
            <input id="ap-hours" name="hours" type="number" min="0" max="500" step="0.01" required defaultValue={defaultHours} className="block min-h-[40px] w-full rounded-lg border border-ink-200 bg-ink-50 px-2 text-sm tabular-nums" />
            <p className="mt-0.5 text-[11px] text-ink-400">{workingDays} working days × 8 hrs</p>
          </div>
          <div>
            <label htmlFor="ap-rate" className="mb-1 block text-xs font-medium text-ink-700">Rate per hour</label>
            <input id="ap-rate" name="rate" type="number" min="0" step="0.01" placeholder={chosen?.rate ? String(Math.round(chosen.rate * 100) / 100) : "from profile"} className="block min-h-[40px] w-full rounded-lg border border-ink-200 bg-ink-50 px-2 text-sm tabular-nums" />
            <p className="mt-0.5 text-[11px] text-ink-400">{chosen?.rate ? "Leave blank to use the rate from their profile" : "No rate on their profile — enter one"}</p>
          </div>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" disabled={busy} className="inline-flex min-h-[40px] items-center rounded-lg bg-brand-500 px-4 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50">
          {busy ? "Adding…" : "Add to this run"}
        </button>
      </form>
    </details>
  );
}
