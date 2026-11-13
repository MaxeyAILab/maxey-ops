"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label } from "@/components/ui";
import { toast } from "@/components/feedback-provider";

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Couldn't read that file"));
    r.readAsDataURL(file);
  });
}

const MAX_BYTES = 3 * 1024 * 1024;

/** Upload form for a progress report PDF (Owner, PM, Project Engineer). */
export function UploadProgressReportForm({ projectId, defaultFrom }: { projectId: string; defaultFrom?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const form = e.currentTarget;
    const fd = new FormData(form);
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) return setError("Choose the PDF file");
    if (file.type && file.type !== "application/pdf") return setError("Upload the progress report as a PDF");
    if (file.size > MAX_BYTES) return setError("That PDF is over 3 MB — save it smaller (e.g. compress the photos) and try again");
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/progress-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          periodFrom: fd.get("periodFrom"),
          periodTo: fd.get("periodTo"),
          title: fd.get("title") || null,
          notes: fd.get("notes") || null,
          dataUrl: await readFile(file),
          fileName: file.name,
        }),
      });
      if (res.ok) {
        form.reset();
        toast("Progress report uploaded");
        router.refresh();
      } else setError(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Upload failed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    }
    setBusy(false);
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2">
      <div>
        <Label htmlFor="pr-from">Reporting period — from *</Label>
        <Input id="pr-from" name="periodFrom" type="date" required defaultValue={defaultFrom} />
      </div>
      <div>
        <Label htmlFor="pr-to">to *</Label>
        <Input id="pr-to" name="periodTo" type="date" required />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="pr-title">Title</Label>
        <Input id="pr-title" name="title" maxLength={200} placeholder="Leave blank for “<project> — Site Progress Report”" />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="pr-file">Progress report PDF * (max 3 MB)</Label>
        <input id="pr-file" name="file" type="file" required accept="application/pdf" className="block w-full text-sm" />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="pr-notes">Notes</Label>
        <Input id="pr-notes" name="notes" maxLength={1000} placeholder="e.g., Covers DCR-001 to DCR-009" />
      </div>
      {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
      <div className="sm:col-span-2">
        <Button type="submit" disabled={busy}>
          {busy ? "Uploading…" : "Upload progress report"}
        </Button>
      </div>
    </form>
  );
}

/** Remove an uploaded report (Owner/PM, or whoever uploaded it). */
export function RemoveProgressReportButton({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      className="text-xs font-medium text-red-700 hover:underline disabled:opacity-50 dark:text-red-300"
      onClick={async () => {
        if (!window.confirm(`Remove the progress report "${label}"? You can upload it again later.`)) return;
        setBusy(true);
        const res = await fetch(`/api/progress-reports/${id}`, { method: "DELETE" });
        setBusy(false);
        if (res.ok) {
          toast("Progress report removed");
          router.refresh();
        } else toast(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Couldn't remove it", "error");
      }}
    >
      Remove
    </button>
  );
}
