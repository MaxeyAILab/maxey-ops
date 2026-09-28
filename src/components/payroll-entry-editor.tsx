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
                <td className="px-2 py-1.5 font-medium">{e.name}</td>
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
