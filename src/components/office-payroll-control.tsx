"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardBody, CardHeader, Input } from "@/components/ui";

interface Person {
  id: string;
  name: string;
  position: string;
  /** the first day paid by the office payroll, when they already are */
  from: string | null;
}

/**
 * Owner only, on the timekeeper sheet: pay a person on this project (the project engineer…) through the office's semi-monthly payroll
 * (1st–15th and 16th–end of the month) from a date, instead of the project's weekly crew payroll. Their time then sits on a panel of
 * its own, is left out of the project's payroll runs and is counted in the office run.
 */
export function OfficePayrollControl({ people, defaultFrom }: { people: Person[]; defaultFrom: string }) {
  const router = useRouter();
  const [from, setFrom] = useState<Record<string, string>>(() => Object.fromEntries(people.map((p) => [p.id, p.from ?? defaultFrom])));
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ id: string; text: string; ok: boolean } | null>(null);

  async function save(p: Person, to: string | null) {
    const ask = to
      ? `Pay ${p.name} through the office payroll (1st–15th and 16th–end of the month) from ${to}?\n\nTheir time from that day is taken out of this project's weekly payroll — a line in a draft weekly run is removed — and counted in the office run instead — charged to this project's cost, and never counted twice with their own clock-ins.`
      : `Move ${p.name} back to the project's weekly payroll?\n\nThis is refused if an approved office payroll has already paid those days.`;
    if (!window.confirm(ask)) return;
    setBusy(p.id);
    setMsg(null);
    const res = await fetch(`/api/personnel/${p.id}/office-payroll`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from: to }) });
    const data = (await res.json().catch(() => null)) as { error?: string; removedFromRuns?: { project: string; period: string }[] } | null;
    setBusy(null);
    if (!res.ok) return setMsg({ id: p.id, ok: false, text: data?.error ?? "Could not save" });
    const removed = data?.removedFromRuns ?? [];
    setMsg({ id: p.id, ok: true, text: removed.length ? `Done. Taken out of the draft payroll run${removed.length === 1 ? "" : "s"}: ${removed.map((r) => `${r.project} (${r.period})`).join(", ")}.` : "Done." });
    router.refresh();
  }

  return (
    <Card>
      <CardHeader title="Office payroll for project staff" subtitle="Owner only — for staff on this project who are paid by the office payroll (1st–15th, 16th–end of the month), not the project's weekly payroll" />
      <CardBody className="space-y-3">
        {people.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center gap-3 text-sm">
            <div className="min-w-[10rem]">
              <div className="font-medium text-ink-900">{p.name}</div>
              <div className="text-xs text-ink-500">{p.position}</div>
            </div>
            {p.from ? (
              <>
                <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">Office payroll from {p.from}</span>
                <Button type="button" variant="secondary" className="text-xs" disabled={busy === p.id} onClick={() => save(p, null)}>
                  Move back to the project payroll
                </Button>
              </>
            ) : (
              <>
                <label className="flex items-center gap-2 text-xs text-ink-600">
                  from
                  <Input type="date" value={from[p.id]} onChange={(e) => setFrom((f) => ({ ...f, [p.id]: e.target.value }))} className="w-40" />
                </label>
                <Button type="button" className="text-xs" disabled={busy === p.id || !from[p.id]} onClick={() => save(p, from[p.id])}>
                  Pay through the office payroll
                </Button>
              </>
            )}
            {msg?.id === p.id && <span className={`text-xs ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.text}</span>}
          </div>
        ))}
      </CardBody>
    </Card>
  );
}
