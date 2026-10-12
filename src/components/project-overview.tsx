"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { FigText } from "@/components/figure-visibility";

// ---------- progress review (PM / Owner) ----------

/** Approve a submitted progress entry, or query it back with a note. The
 * server applies the decision once even on a double click. */
export function ProgressReviewControls({ entryId }: { entryId: string }) {
  const router = useRouter();
  const [querying, setQuerying] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(decision: "APPROVED" | "QUERIED") {
    if (busy) return;
    setBusy(true);
    setError("");
    const res = await fetch(`/api/progress/${entryId}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, note: decision === "QUERIED" ? note : undefined }),
    });
    setBusy(false);
    if (res.ok) {
      setQuerying(false);
      router.refresh();
    } else {
      setError((await res.json()).error ?? "Failed");
    }
  }

  return (
    <div className="mt-2 space-y-2">
      {!querying ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="success" disabled={busy} onClick={() => submit("APPROVED")} className="min-h-[36px] text-xs">
            ✓ Approve
          </Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => setQuerying(true)} className="min-h-[36px] text-xs">
            Query…
          </Button>
        </div>
      ) : (
        <div className="space-y-2 rounded-sm border border-amber-300 bg-amber-50 p-2 dark:border-amber-800 dark:bg-amber-950/30">
          <label className="block text-xs font-medium text-ink-700">
            What needs fixing or clarifying?
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={2000}
              className="mt-1 block w-full rounded border border-ink-200 bg-ink-50 px-2 py-1 text-sm"
            />
          </label>
          <div className="flex gap-2">
            <Button type="button" disabled={busy || note.trim().length < 3} onClick={() => submit("QUERIED")} className="min-h-[36px] text-xs">
              Send query
            </Button>
            <Button type="button" variant="secondary" onClick={() => setQuerying(false)} className="min-h-[36px] text-xs">
              Cancel
            </Button>
          </div>
        </div>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

// ---------- recent site activity (filterable) ----------

export interface ActivityRow {
  key: string;
  type: "progress" | "report" | "change" | "payment" | "requisition";
  at: string; // ISO
  title: string;
  detail: string;
  actor: string;
  href: string;
  archived?: boolean;
}

const TYPE_LABELS: Record<ActivityRow["type"], string> = {
  progress: "Progress",
  report: "Daily reports",
  change: "Changes",
  payment: "Payments",
  requisition: "Requisitions",
};

const dateFmt = new Intl.DateTimeFormat("en-PH", {
  timeZone: "Asia/Manila",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function ActivityFeed({ rows }: { rows: ActivityRow[] }) {
  const [filter, setFilter] = useState<ActivityRow["type"] | "all">("all");
  const types = Array.from(new Set(rows.map((r) => r.type)));
  const shown = filter === "all" ? rows : rows.filter((r) => r.type === filter);

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Filter activity by type">
        {(["all", ...types] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setFilter(t)}
            aria-pressed={filter === t}
            className={`min-h-[32px] rounded-sm border px-2.5 text-xs font-medium ${
              filter === t ? "border-brand-500 bg-brand-50 text-brand-700" : "border-ink-200 text-ink-600 hover:bg-ink-100"
            }`}
          >
            {t === "all" ? "All" : TYPE_LABELS[t]}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="py-4 text-sm text-ink-500">No activity yet.</p>
      ) : (
        <ol className="space-y-2.5">
          {shown.map((r) => (
            <li key={r.key} className="flex gap-3 text-sm">
              <span className="w-28 shrink-0 text-xs tabular-nums text-ink-500">{dateFmt.format(new Date(r.at))}</span>
              <div className="min-w-0">
                <Link href={r.href} className="font-medium text-ink-900 hover:text-brand-600 hover:underline">
                  <FigText>{r.title}</FigText>
                </Link>
                <div className="text-xs text-ink-500">
                  {r.actor}
                  {r.detail && <> · {r.detail}</>}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ---------- section navigation ----------

export function ProjectSectionNav({ sections }: { sections: { id: string; label: string }[] }) {
  return (
    <nav aria-label="Project sections" className="-mx-4 overflow-x-auto border-b border-ink-200 bg-ink-100/95 px-4 backdrop-blur md:sticky md:top-0 md:z-10">
      <ul className="flex gap-1 whitespace-nowrap py-1.5 text-sm">
        {sections.map((s) => (
          <li key={s.id}>
            <a
              href={`#${s.id}`}
              className="inline-flex min-h-[36px] items-center rounded-sm px-3 font-medium text-ink-600 hover:bg-ink-200 hover:text-ink-900"
            >
              {s.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
