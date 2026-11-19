"use client";

import { useMemo, useState } from "react";

export type CrewStatus = "in" | "stale" | "done" | "none";
export type CrewFilter = "all" | "none" | "in" | "done" | "stale";

export interface CrewRow {
  key: string;
  name: string;
  position: string;
  status: CrewStatus;
  /** the whole <tr>, rendered on the server (it carries the Owner's edit buttons) */
  row: React.ReactNode;
}

export interface CrewSection {
  key: string;
  title: string;
  subtitle: string;
  header: React.ReactNode;
  rows: CrewRow[];
}

const FILTERS: { id: CrewFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "none", label: "Not logged" },
  { id: "in", label: "Clocked in" },
  { id: "done", label: "Done for the day" },
  { id: "stale", label: "Still in from earlier days" },
];

const matches = (s: CrewStatus, f: CrewFilter) => f === "all" || s === f;

/** Today's crew, one folded row per project with a "logged" bar; projects with workers who
 * haven't logged today sort to the top and start open. Filter chips + name search. */
export function AttendanceCrewBoard({
  sections,
  initialFilter = "all",
  emptyNote,
}: {
  sections: CrewSection[];
  initialFilter?: CrewFilter;
  emptyNote?: string;
}) {
  const [filter, setFilter] = useState<CrewFilter>(initialFilter);
  const [q, setQ] = useState("");
  const [toggled, setToggled] = useState<Record<string, boolean>>({});

  const counts = useMemo(() => {
    // count people once even if they are on several rosters
    const best = new Map<string, CrewStatus>();
    const rank: Record<CrewStatus, number> = { in: 3, done: 2, stale: 1, none: 0 };
    for (const s of sections)
      for (const r of s.rows) {
        const id = r.key.split(":").pop()!;
        const prev = best.get(id);
        if (prev === undefined || rank[r.status] > rank[prev]) best.set(id, r.status);
      }
    const all = Array.from(best.values());
    return {
      all: all.length,
      none: all.filter((s) => s === "none").length,
      in: all.filter((s) => s === "in").length,
      done: all.filter((s) => s === "done").length,
      stale: all.filter((s) => s === "stale").length,
    } as Record<CrewFilter, number>;
  }, [sections]);

  const needle = q.trim().toLowerCase();
  const narrowing = filter !== "all" || needle !== "";

  const view = sections
    .map((s) => {
      const missing = s.rows.filter((r) => r.status === "none").length;
      const visible = s.rows.filter(
        (r) => matches(r.status, filter) && (!needle || r.name.toLowerCase().includes(needle) || r.position.toLowerCase().includes(needle))
      );
      return { ...s, missing, logged: s.rows.length - missing, visible };
    })
    .filter((s) => !narrowing || s.visible.length > 0)
    .sort((a, b) => (b.missing > 0 ? 1 : 0) - (a.missing > 0 ? 1 : 0));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.filter((f) => f.id !== "stale" || counts.stale > 0).map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition ${
              filter === f.id ? "fx-chip-on border-transparent" : "border-ink-200 bg-ink-50 text-ink-600 hover:border-ink-400"
            }`}
          >
            {f.label} <span className="font-mono opacity-70">{counts[f.id]}</span>
          </button>
        ))}
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="⌕  Search name or position…"
          className="w-full rounded-full border border-ink-200 bg-ink-50 px-4 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:outline-none sm:ml-auto sm:w-64"
        />
      </div>

      {view.length === 0 && (
        <div className="fx-card rounded-2xl border border-ink-200 bg-ink-50 p-6 text-center text-sm text-ink-400">
          {sections.length === 0 ? emptyNote ?? "No personnel yet." : "Nobody matches."}
        </div>
      )}

      {view.map((s) => {
        const open = narrowing ? true : toggled[s.key] ?? s.missing > 0;
        const pct = s.rows.length ? Math.round((s.logged / s.rows.length) * 100) : 0;
        return (
          <div key={s.key} className="fx-card overflow-hidden rounded-2xl border border-ink-200 bg-ink-50">
            <button
              type="button"
              onClick={() => setToggled((t) => ({ ...t, [s.key]: !open }))}
              className="flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3.5 text-left hover:bg-ink-100/40 sm:px-5"
              aria-expanded={open}
            >
              <span className={`text-xs text-ink-400 transition ${open ? "rotate-90" : ""}`}>▶</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-ink-900">{s.title}</span>
                <span className="block text-[11px] text-ink-400">{s.subtitle}</span>
              </span>
              <span className="font-mono text-xs text-ink-500">
                {s.logged}/{s.rows.length}
              </span>
              {s.rows.length > 0 && s.rows.length <= 24 ? (
                // one block per worker, lit when they have logged today
                <span className="hidden w-36 gap-0.5 sm:flex">
                  {s.rows.map((r, i) => (
                    <span key={i} className={`h-2 flex-1 rounded-sm ${i < s.logged ? "fx-ok-bg" : "bg-ink-200"}`} />
                  ))}
                </span>
              ) : (
                <span className="hidden h-2 w-36 overflow-hidden rounded-full bg-ink-200 sm:block">
                  <span className="fx-ok-bg block h-full" style={{ width: `${pct}%` }} />
                </span>
              )}
              <span
                className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                  s.rows.length === 0 ? "bg-ink-100 text-ink-500" : s.missing ? "bg-accent/10 text-accent" : "fx-ok bg-emerald-500/10"
                }`}
              >
                {s.rows.length === 0 ? "No one yet" : s.missing ? `${s.missing} not logged` : "All in ✓"}
              </span>
            </button>
            {open && (
              <div className="overflow-x-auto border-t border-ink-100">
                <table className="w-full text-left text-sm">
                  {s.header}
                  <tbody>
                    {s.visible.map((r) => (
                      <RowSlot key={r.key}>{r.row}</RowSlot>
                    ))}
                    {s.visible.length === 0 && (
                      <tr>
                        <td colSpan={8} className="py-6 text-center text-sm text-ink-400">
                          No personnel here yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function RowSlot({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
