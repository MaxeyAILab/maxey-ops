"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { AM_FROM, AM_TO, FULL_DAY, MAX_OVERTIME_HOURS, PM_FROM, PM_TO, regularHours, validateSheetRow, type SheetInput } from "@/lib/timesheet";

export interface SheetWorker {
  userId: string;
  name: string;
  position: string;
  department: string | null;
  /** what is saved for this day (null = nothing recorded yet) */
  saved: {
    amIn: string | null;
    amOut: string | null;
    pmIn: string | null;
    pmOut: string | null;
    otHours: number | null;
    approvedBy: string | null;
    remarks: string | null;
    absent: boolean;
    enteredByName: string;
    /** the overtime's standing with the Owner / PM */
    otStatus: "PENDING" | "APPROVED" | "REJECTED" | null;
    otCredited: number | null;
  } | null;
}

interface RowState {
  amIn: string;
  amOut: string;
  pmIn: string;
  pmOut: string;
  ot: string;
  approvedBy: string;
  remarks: string;
  absent: boolean;
}

const fromSaved = (w: SheetWorker): RowState => ({
  amIn: w.saved?.amIn ?? "",
  amOut: w.saved?.amOut ?? "",
  pmIn: w.saved?.pmIn ?? "",
  pmOut: w.saved?.pmOut ?? "",
  ot: w.saved?.otHours ? String(w.saved.otHours) : "",
  approvedBy: w.saved?.approvedBy ?? "",
  remarks: w.saved?.remarks ?? "",
  absent: w.saved?.absent ?? false,
});

const toInput = (r: RowState): SheetInput => ({
  amIn: r.amIn || null,
  amOut: r.amOut || null,
  pmIn: r.pmIn || null,
  pmOut: r.pmOut || null,
  otHours: r.ot.trim() === "" ? null : Number(r.ot),
  approvedBy: r.approvedBy.trim() || null,
  remarks: r.remarks.trim() || null,
  absent: r.absent,
});

const same = (a: RowState, b: RowState) => JSON.stringify(a) === JSON.stringify(b);
const cell = "w-[5.6rem] rounded-md border border-ink-200 bg-white px-1.5 py-1 text-xs tabular-nums text-ink-900 disabled:bg-ink-50 disabled:text-ink-500 dark:bg-transparent";

/**
 * The timekeeper's daily sheet: one line per worker, AM in/out (7:30 – 12:00), PM in/out (1:00 – 5:00), overtime after 5:00 PM,
 * the paid hours as they are typed, who approved it on site, and remarks. Ticking AM and/or PM for a worker who is in fills the
 * standard times (7:30–12:00, 1:00–5:00), so a normal day is two ticks; the time boxes stay editable for the exceptions (late,
 * undertime, overtime). Saving writes each worker's clock records.
 */
export function TimekeeperSheet({
  projectId,
  dayKey,
  workers,
  approvers,
  canEdit,
  lockedReason,
}: {
  projectId: string;
  dayKey: string;
  workers: SheetWorker[];
  /** engineers and foremen on this project (suggestions for "Approved by") */
  approvers: string[];
  canEdit: boolean;
  /** why the sheet cannot be edited, when it cannot */
  lockedReason: string | null;
}) {
  const router = useRouter();
  const initial = useMemo(() => Object.fromEntries(workers.map((w) => [w.userId, fromSaved(w)])), [workers]);
  const [rows, setRows] = useState<Record<string, RowState>>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const editable = canEdit && !lockedReason;

  const dirtyIds = workers.filter((w) => !same(rows[w.userId], initial[w.userId])).map((w) => w.userId);
  const set = (id: string, patch: Partial<RowState>) => setRows((r) => ({ ...r, [id]: { ...r[id], ...patch } }));
  /** a half of the day is "ticked" when both of its times are there */
  const amTicked = (r: RowState) => !!r.amIn && !!r.amOut;
  const pmTicked = (r: RowState) => !!r.pmIn && !!r.pmOut;
  /** Ticking fills the standard times (and un-marks absent); unticking takes the times away. Times already typed are kept when ticking. */
  const tick = (id: string, half: "AM" | "PM", on: boolean) =>
    setRows((all) => {
      const r = all[id];
      if (half === "AM") return { ...all, [id]: on ? { ...r, absent: false, amIn: r.amIn || FULL_DAY.amIn, amOut: r.amOut || FULL_DAY.amOut } : { ...r, amIn: "", amOut: "" } };
      return { ...all, [id]: on ? { ...r, absent: false, pmIn: r.pmIn || FULL_DAY.pmIn, pmOut: r.pmOut || FULL_DAY.pmOut } : { ...r, pmIn: "", pmOut: "", ot: "" } };
    });
  /** The tick in a column heading ticks (or unticks) that half for every worker who is not marked absent. */
  const tickAll = (half: "AM" | "PM", on: boolean) =>
    setRows((all) => {
      const next = { ...all };
      for (const w of workers) {
        const r = next[w.userId];
        if (r.absent) continue;
        if (half === "AM") next[w.userId] = on ? { ...r, amIn: r.amIn || FULL_DAY.amIn, amOut: r.amOut || FULL_DAY.amOut } : { ...r, amIn: "", amOut: "" };
        else next[w.userId] = on ? { ...r, pmIn: r.pmIn || FULL_DAY.pmIn, pmOut: r.pmOut || FULL_DAY.pmOut } : { ...r, pmIn: "", pmOut: "", ot: "" };
      }
      return next;
    });
  const everyone = (half: "AM" | "PM") => {
    const live = workers.filter((w) => !rows[w.userId].absent);
    return live.length > 0 && live.every((w) => (half === "AM" ? amTicked(rows[w.userId]) : pmTicked(rows[w.userId])));
  };
  const clearRow = (id: string) => set(id, { amIn: "", amOut: "", pmIn: "", pmOut: "", ot: "", approvedBy: "", absent: false });
  const absent = (id: string) => set(id, { amIn: "", amOut: "", pmIn: "", pmOut: "", ot: "", absent: true });

  function allPresent() {
    setRows((r) => {
      const next = { ...r };
      for (const w of workers) {
        const x = next[w.userId];
        if (!x.absent && !x.amIn && !x.amOut && !x.pmIn && !x.pmOut) next[w.userId] = { ...x, amIn: FULL_DAY.amIn, amOut: FULL_DAY.amOut, pmIn: FULL_DAY.pmIn, pmOut: FULL_DAY.pmOut };
      }
      return next;
    });
  }

  async function save() {
    setMsg("");
    const problems: Record<string, string> = {};
    for (const id of dirtyIds) {
      const p = validateSheetRow(toInput(rows[id]));
      if (p) problems[id] = p;
    }
    setErrors(problems);
    if (Object.keys(problems).length > 0) return setMsg("Fix the lines marked in red, then save again.");
    setBusy(true);
    const res = await fetch("/api/timesheet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        date: dayKey,
        rows: dirtyIds.map((id) => {
          const i = toInput(rows[id]);
          return { userId: id, amIn: i.amIn, amOut: i.amOut, pmIn: i.pmIn, pmOut: i.pmOut, otHours: i.otHours, approvedBy: i.approvedBy, remarks: i.remarks, absent: i.absent };
        }),
      }),
    });
    setBusy(false);
    const data = (await res.json().catch(() => null)) as { error?: string; saved?: number; results?: { userId: string; ok: boolean; error?: string }[] } | null;
    if (!data || (!res.ok && !data.results)) return setMsg(data?.error ?? "Could not save the sheet");
    const bad: Record<string, string> = {};
    for (const r of data.results ?? []) if (!r.ok) bad[r.userId] = r.error ?? "Not saved";
    setErrors(bad);
    setMsg(Object.keys(bad).length ? `${data.saved} line${data.saved === 1 ? "" : "s"} saved — the lines marked in red were not.` : `Saved ${data.saved} line${data.saved === 1 ? "" : "s"}.`);
    router.refresh();
  }

  const totals = workers.reduce(
    (t, w) => {
      const i = toInput(rows[w.userId]);
      if (validateSheetRow(i) === null) t.hours += regularHours(dayKey, i, w.department);
      t.ot += i.otHours && i.otHours > 0 ? i.otHours : 0;
      if (i.absent) t.absent += 1;
      else if (i.amIn || i.pmIn) t.present += 1;
      return t;
    },
    { hours: 0, ot: 0, present: 0, absent: 0 }
  );

  return (
    <div className="space-y-3">
      {lockedReason && <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">{lockedReason}</p>}
      <datalist id="approver-names">
        {approvers.map((a) => (
          <option key={a} value={a} />
        ))}
      </datalist>

      {editable && (
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <Button type="button" variant="secondary" className="text-xs" onClick={allPresent}>
            Everyone not yet recorded: AM + PM
          </Button>
          <span className="text-ink-500">
            Tick AM / PM for a worker who is in (AM {AM_FROM}–{AM_TO}, PM {PM_FROM}–{PM_TO}). Change a time box for late arrivals or undertime.
          </span>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-ink-100">
        <table className="w-full min-w-[64rem] text-left text-sm">
          <thead className="bg-ink-50 text-[11px] uppercase tracking-wide text-ink-500 dark:bg-transparent">
            <tr>
              <th className="px-3 py-2">Worker</th>
              <th className="px-2 py-2" colSpan={3}>
                <label className="inline-flex items-center gap-1.5">
                  {editable && <input type="checkbox" aria-label="Tick AM for everyone" checked={everyone("AM")} onChange={(e) => tickAll("AM", e.target.checked)} />}
                  AM <span className="font-normal normal-case">in / out</span>
                </label>
              </th>
              <th className="px-2 py-2" colSpan={3}>
                <label className="inline-flex items-center gap-1.5">
                  {editable && <input type="checkbox" aria-label="Tick PM for everyone" checked={everyone("PM")} onChange={(e) => tickAll("PM", e.target.checked)} />}
                  PM <span className="font-normal normal-case">in / out</span>
                </label>
              </th>
              <th className="px-2 py-2">
                OT <span className="font-normal normal-case">hrs after 5 PM</span>
              </th>
              <th className="px-2 py-2 text-right">Paid hrs</th>
              <th className="px-3 py-2">Remarks · approved by (site/project engineer or foreman)</th>
              {editable && <th className="px-2 py-2" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {workers.map((w) => {
              const r = rows[w.userId];
              const i = toInput(r);
              const problem = errors[w.userId] ?? (dirtyIds.includes(w.userId) ? validateSheetRow(i) : null);
              const hours = validateSheetRow(i) === null ? regularHours(dayKey, i, w.department) : null;
              const dirty = dirtyIds.includes(w.userId);
              return (
                <tr key={w.userId} className={dirty ? "bg-amber-50/60 dark:bg-amber-950/10" : ""}>
                  <td className="px-3 py-2 align-top">
                    <div className="font-medium text-ink-900">{w.name}</div>
                    <div className="text-xs text-ink-500">{w.position}</div>
                    {w.saved && !dirty && <div className="text-[11px] text-ink-400">saved by {w.saved.enteredByName}</div>}
                  </td>
                  {r.absent ? (
                    <td colSpan={7} className="px-2 py-2 align-top">
                      <span className="inline-flex flex-wrap items-center gap-3">
                        <span className="inline-flex items-center rounded-sm bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800 dark:bg-red-950/40 dark:text-red-300">Absent</span>
                        {editable && (
                          <span className="flex gap-3 text-xs text-ink-600">
                            <label className="inline-flex items-center gap-1">
                              <input type="checkbox" aria-label={`${w.name} AM present`} checked={false} onChange={() => tick(w.userId, "AM", true)} /> AM in
                            </label>
                            <label className="inline-flex items-center gap-1">
                              <input type="checkbox" aria-label={`${w.name} PM present`} checked={false} onChange={() => tick(w.userId, "PM", true)} /> PM in
                            </label>
                          </span>
                        )}
                      </span>
                    </td>
                  ) : (
                    <>
                      <td className="px-2 py-2 align-top">
                        <input type="checkbox" aria-label={`${w.name} present in the morning`} className="mt-1.5 h-4 w-4" checked={amTicked(r)} disabled={!editable} onChange={(e) => tick(w.userId, "AM", e.target.checked)} />
                      </td>
                      <td className="px-1 py-2 align-top">
                        <input type="time" aria-label={`${w.name} AM in`} className={cell} value={r.amIn} min={AM_FROM} max={AM_TO} disabled={!editable} onChange={(e) => set(w.userId, { amIn: e.target.value })} />
                      </td>
                      <td className="px-1 py-2 align-top">
                        <input type="time" aria-label={`${w.name} AM out`} className={cell} value={r.amOut} min={AM_FROM} max={AM_TO} disabled={!editable} onChange={(e) => set(w.userId, { amOut: e.target.value })} />
                      </td>
                      <td className="px-2 py-2 align-top">
                        <input type="checkbox" aria-label={`${w.name} present in the afternoon`} className="mt-1.5 h-4 w-4" checked={pmTicked(r)} disabled={!editable} onChange={(e) => tick(w.userId, "PM", e.target.checked)} />
                      </td>
                      <td className="px-1 py-2 align-top">
                        <input type="time" aria-label={`${w.name} PM in`} className={cell} value={r.pmIn} min={PM_FROM} max={PM_TO} disabled={!editable} onChange={(e) => set(w.userId, { pmIn: e.target.value })} />
                      </td>
                      <td className="px-1 py-2 align-top">
                        <input type="time" aria-label={`${w.name} PM out`} className={cell} value={r.pmOut} min={PM_FROM} max={PM_TO} disabled={!editable} onChange={(e) => set(w.userId, { pmOut: e.target.value })} />
                      </td>
                      <td className="px-2 py-2 align-top">
                        <input type="number" inputMode="decimal" min="0" max={MAX_OVERTIME_HOURS} step="0.25" aria-label={`${w.name} overtime hours`} className={`${cell} w-[4.5rem]`} value={r.ot} disabled={!editable} onChange={(e) => set(w.userId, { ot: e.target.value })} />
                        {w.saved?.otHours && !dirty && (
                          <div className={`mt-1 text-[11px] ${w.saved.otStatus === "APPROVED" ? "text-emerald-700" : w.saved.otStatus === "REJECTED" ? "text-red-700" : "text-amber-700"}`}>
                            {w.saved.otStatus === "APPROVED" ? `approved${w.saved.otCredited != null ? ` ${w.saved.otCredited} h` : ""}` : w.saved.otStatus === "REJECTED" ? "not approved" : "waiting for Owner/PM"}
                          </div>
                        )}
                      </td>
                    </>
                  )}
                  <td className="px-2 py-2 text-right align-top tabular-nums">{hours === null ? "—" : hours.toFixed(2)}</td>
                  <td className="px-3 py-2 align-top">
                    <div className="flex flex-wrap gap-1.5">
                      <input list="approver-names" aria-label={`${w.name} approved by`} placeholder="Approved by" className={`${cell} w-36`} value={r.approvedBy} disabled={!editable} onChange={(e) => set(w.userId, { approvedBy: e.target.value })} maxLength={120} />
                      <input aria-label={`${w.name} remarks`} placeholder="Remarks" className={`${cell} min-w-[10rem] flex-1`} value={r.remarks} disabled={!editable} onChange={(e) => set(w.userId, { remarks: e.target.value })} maxLength={300} />
                    </div>
                    {problem && <p className="mt-1 text-xs text-red-600">{problem}</p>}
                  </td>
                  {editable && (
                    <td className="whitespace-nowrap px-2 py-2 text-right align-top text-xs">
                      <button type="button" onClick={() => absent(w.userId)} className="mr-2 text-ink-600 hover:underline">
                        Absent
                      </button>
                      <button type="button" onClick={() => clearRow(w.userId)} className="text-ink-400 hover:underline">
                        Clear
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
            {workers.length === 0 && (
              <tr>
                <td colSpan={11} className="px-3 py-6 text-center text-sm text-ink-400">
                  No workers without a login are assigned to this project. Workers added without an email are listed here once the Owner assigns them to the project (Attendance → Edit).
                </td>
              </tr>
            )}
          </tbody>
          {workers.length > 0 && (
            <tfoot className="bg-ink-50 text-xs font-medium text-ink-700 dark:bg-transparent">
              <tr>
                <td className="px-3 py-2">
                  {totals.present} present · {totals.absent} absent · {workers.length - totals.present - totals.absent} not recorded
                </td>
                <td colSpan={7} className="px-2 py-2 text-right">
                  Overtime recorded {totals.ot > 0 ? `${totals.ot} h` : "—"}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{totals.hours.toFixed(2)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {editable && (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={save} disabled={busy || dirtyIds.length === 0}>
            {busy ? "Saving…" : dirtyIds.length === 0 ? "Nothing to save" : `Save ${dirtyIds.length} changed line${dirtyIds.length === 1 ? "" : "s"}`}
          </Button>
          {dirtyIds.length > 0 && !busy && (
            <button type="button" className="text-xs text-ink-500 hover:underline" onClick={() => (setRows(initial), setErrors({}), setMsg(""))}>
              Undo my changes
            </button>
          )}
          {msg && <p className="text-sm text-ink-700">{msg}</p>}
        </div>
      )}
      <p className="text-xs text-ink-500">
        Paid hours take off the 12:00–1:00 lunch and the two 15-minute breaks, the same as everyone&apos;s time. Overtime is counted in pay only after the Owner or PM approves it
        (Attendance tab). Approved by is the site/project engineer or the foreman who agreed to the day or the overtime.
      </p>
    </div>
  );
}
