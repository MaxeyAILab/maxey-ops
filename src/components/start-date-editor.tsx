"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { fmtDate } from "@/lib/format";

/**
 * A project's start date. Everyone who sees it reads it as plain text; the Owner also gets a small "Edit" next to it to correct or
 * set it (a date picker, saved at once). `variant="header"` reads "started 14 Oct 2026"; `variant="cell"` is just the date, for the
 * Projects table.
 */
export function StartDateEditor({
  projectId,
  value,
  canEdit,
  variant = "cell",
}: {
  projectId: string;
  /** the stored date as an ISO string, or null when there is none */
  value: string | null;
  canEdit: boolean;
  variant?: "cell" | "header";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value ? value.slice(0, 10) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const text = variant === "header" ? (value ? `started ${fmtDate(value)}` : "not started") : fmtDate(value);

  async function save(next: string | null) {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/projects/${projectId}/start-date`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startDate: next }),
    });
    setBusy(false);
    if (!res.ok) return setError(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Could not save");
    setOpen(false);
    router.refresh();
  }

  if (!canEdit) return <span>{text}</span>;

  if (!open) {
    return (
      <span className="whitespace-nowrap">
        {text}{" "}
        <button type="button" onClick={() => setOpen(true)} className="text-xs font-medium text-brand-600 hover:underline" aria-label="Edit the start date">
          Edit
        </button>
      </span>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 align-middle">
      <input
        type="date"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        aria-label="Start date"
        className="rounded-lg border border-ink-200 bg-white px-2 py-1 text-xs text-ink-900 dark:bg-transparent"
      />
      <button type="button" disabled={busy || !draft} onClick={() => save(draft)} className="rounded-lg bg-brand-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-50">
        {busy ? "Saving…" : "Save"}
      </button>
      {value && (
        <button type="button" disabled={busy} onClick={() => window.confirm("Clear the start date? The project will read as not started.") && save(null)} className="text-xs text-red-600 hover:underline">
          Clear
        </button>
      )}
      <button type="button" disabled={busy} onClick={() => setOpen(false)} className="text-xs text-ink-500 hover:underline">
        Cancel
      </button>
      {error && <span className="basis-full text-xs text-red-600">{error}</span>}
    </span>
  );
}
