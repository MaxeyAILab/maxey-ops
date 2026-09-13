"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Owner types in what the bank app shows right now — the only way "cash on
 * hand" gets updated, since there's no bank integration. */
export function UpdateCashForm({ current }: { current: number | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const fd = new FormData(e.currentTarget);
    const res = await fetch("/api/finance/cash-snapshot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: fd.get("amount"), note: fd.get("note") }),
    });
    setBusy(false);
    if (res.ok) {
      setOpen(false);
      router.refresh();
    } else {
      setError((await res.json()).error ?? "Failed to save");
    }
  }

  if (!open) {
    return (
      <button type="button" className="findash-linkbtn" onClick={() => setOpen(true)}>
        {current == null ? "Record cash on hand" : "Update"}
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="findash-inlineform">
      <input
        name="amount"
        type="number"
        min="0"
        step="1"
        required
        defaultValue={current ?? ""}
        placeholder="Amount, PHP"
        autoFocus
      />
      <input name="note" type="text" placeholder="Note (optional) — e.g. BPI + BDO combined" />
      {error && <span className="findash-formerror">{error}</span>}
      <div className="findash-inlineform-actions">
        <button type="button" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
        <button type="submit" disabled={busy} className="findash-primary">
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

/** Owner sets/edits the margin % this project was bid at, so the Finance tab
 * can compare it against the forecast-at-completion margin. */
export function SetTargetMarginForm({
  projectId,
  current,
}: {
  projectId: string;
  current: number | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save(value: string) {
    setBusy(true);
    await fetch(`/api/projects/${projectId}/target-margin`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetMarginPct: value === "" ? null : Number(value) }),
    });
    setBusy(false);
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button type="button" className="findash-linkbtn-sm" onClick={() => setOpen(true)}>
        {current == null ? "set bid %" : "edit"}
      </button>
    );
  }

  return (
    <form
      className="findash-margininline"
      onSubmit={(e) => {
        e.preventDefault();
        const value = (e.currentTarget.elements.namedItem("pct") as HTMLInputElement).value;
        save(value);
      }}
    >
      <input name="pct" type="number" step="0.1" defaultValue={current ?? ""} placeholder="e.g. 20" autoFocus />
      <button type="submit" disabled={busy}>
        ✓
      </button>
      <button type="button" onClick={() => setOpen(false)} disabled={busy}>
        ✕
      </button>
    </form>
  );
}
