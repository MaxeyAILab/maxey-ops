"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { submitOrQueue } from "@/lib/outbox";
import { Button, Label, Select, Textarea } from "@/components/ui";
import { PhotoInput } from "@/components/photo-input";

interface ProjectOption {
  id: string;
  name: string;
}

/** Jacob/PM posts a dated, project-specific instruction (Spec 6.6). */
export function PostInstructionForm({ projects }: { projects: ProjectOption[] }) {
  const router = useRouter();
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const fd = new FormData(e.currentTarget);
    const res = await fetch("/api/instructions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: fd.get("projectId"),
        text: fd.get("text"),
        photos,
      }),
    });
    setBusy(false);
    if (res.ok) {
      (e.target as HTMLFormElement).reset?.();
      setPhotos([]);
      router.refresh();
    } else {
      setError((await res.json()).error ?? "Failed to post instruction");
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div>
        <Label htmlFor="insProject">Project</Label>
        <Select id="insProject" name="projectId" required>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="insText">Instruction</Label>
        <Textarea
          id="insText"
          name="text"
          rows={3}
          required
          placeholder="e.g., Re-check column C4 alignment before pouring; use the revised drawing."
        />
      </div>
      <PhotoInput label="Photo / marked-up drawing (optional)" max={2} onChange={setPhotos} />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" disabled={busy}>
        {busy ? "Posting…" : "Post instruction"}
      </Button>
    </form>
  );
}

const NEXT_STATUS: Record<string, { value: string; label: string }> = {
  OPEN: { value: "ACKNOWLEDGED", label: "✓ Acknowledge" },
  ACKNOWLEDGED: { value: "IN_PROGRESS", label: "▶ Start work" },
  IN_PROGRESS: { value: "DONE", label: "✓ Mark done" },
};

/** Site staff advances the status — offline-capable (Spec 6.6/§4). */
export function InstructionStatusButton({
  instructionId,
  status,
}: {
  instructionId: string;
  status: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState(false);

  const next = NEXT_STATUS[status];
  if (!next) return null;

  async function advance() {
    setBusy(true);
    const result = await submitOrQueue({
      url: `/api/instructions/${instructionId}`,
      method: "PATCH",
      label: `Instruction ${next.value.toLowerCase()}`,
      body: { status: next.value },
    });
    setBusy(false);
    if (result.queued) setQueued(true);
    else router.refresh();
  }

  if (queued) {
    return <span className="text-xs text-amber-600">Saved offline — will sync</span>;
  }
  return (
    <Button variant="secondary" disabled={busy} onClick={advance} className="min-h-[36px] px-3 text-xs">
      {busy ? "…" : next.label}
    </Button>
  );
}
