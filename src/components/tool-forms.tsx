"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { submitOrQueue } from "@/lib/outbox";
import { Button, Input, Label, Select } from "@/components/ui";
import { PhotoInput } from "@/components/photo-input";

interface ProjectOption {
  id: string;
  name: string;
}

/** Register a new tool/equipment asset — starts in the warehouse (Spec 6.4). */
export function AddToolForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const fd = new FormData(e.currentTarget);
    const res = await fetch("/api/tools", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: fd.get("name"),
        assetTag: fd.get("assetTag"),
        category: fd.get("category"),
      }),
    });
    setBusy(false);
    if (res.ok) {
      (e.target as HTMLFormElement).reset?.();
      router.refresh();
    } else setError((await res.json()).error ?? "Failed to add tool");
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-4">
      <div className="sm:col-span-2">
        <Label htmlFor="toolName">Tool / equipment name</Label>
        <Input id="toolName" name="name" required placeholder="e.g., Welding Machine" />
      </div>
      <div>
        <Label htmlFor="toolTag">Asset tag (optional)</Label>
        <Input id="toolTag" name="assetTag" placeholder="e.g., WM-002" />
      </div>
      <div>
        <Label htmlFor="toolCategory">Category</Label>
        <Input id="toolCategory" name="category" placeholder="Power Tool" list="tool-categories" />
        <datalist id="tool-categories">
          <option value="Power Tool" />
          <option value="Heavy Equipment" />
          <option value="Hand Tool" />
          <option value="Safety Equipment" />
        </datalist>
      </div>
      {error && <p className="text-sm text-red-600 sm:col-span-4">{error}</p>}
      <div className="sm:col-span-4">
        <Button type="submit" variant="secondary" disabled={busy}>
          {busy ? "Adding…" : "+ Add tool / equipment"}
        </Button>
      </div>
    </form>
  );
}

type Mode = "idle" | "checkout" | "transfer" | "repair" | "lost";

/**
 * Per-tool action row — checkout/return/transfer, or flag under repair/lost
 * (owner's request, 2026-07-07). Available actions depend on the tool's
 * current status so it can't be, say, checked out twice.
 */
export function ToolActions({
  toolId,
  status,
  currentProjectId,
  projects,
}: {
  toolId: string;
  status: "IN_WAREHOUSE" | "ON_SITE" | "UNDER_REPAIR" | "LOST";
  currentProjectId: string | null;
  projects: ProjectOption[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);

  const transferTargets = projects.filter((p) => p.id !== currentProjectId);

  async function act(type: string, body: Record<string, unknown> = {}) {
    setBusy(true);
    setError("");
    const result = await submitOrQueue({
      url: "/api/tools/movements",
      label: `Tool ${type.toLowerCase()}`,
      body: { toolId, type, ...body },
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Failed");
      return;
    }
    setMode("idle");
    setPhotos([]);
    router.refresh();
  }

  if (mode === "checkout" || mode === "transfer") {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          act(mode === "checkout" ? "CHECKOUT_TO_SITE" : "TRANSFER_SITE_TO_SITE", {
            toProjectId: fd.get("toProjectId"),
          });
        }}
        className="flex items-center gap-2"
      >
        <Select name="toProjectId" required className="min-h-[32px] py-0 text-xs">
          {(mode === "checkout" ? projects : transferTargets).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <button type="submit" disabled={busy} className="text-xs font-medium text-brand-600 hover:underline">
          {busy ? "…" : "Confirm"}
        </button>
        <button type="button" onClick={() => setMode("idle")} className="text-xs text-ink-400 hover:text-ink-600">
          Cancel
        </button>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </form>
    );
  }

  if (mode === "repair" || mode === "lost") {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          act(mode === "repair" ? "MARK_UNDER_REPAIR" : "MARK_LOST", {
            condition: fd.get("condition"),
            photo: photos[0],
          });
        }}
        className="space-y-2 rounded-lg bg-ink-50 p-2"
      >
        <Input name="condition" placeholder="What happened? (optional)" className="min-h-[32px] text-xs" />
        <PhotoInput max={1} onChange={setPhotos} />
        <div className="flex items-center gap-2">
          <button type="submit" disabled={busy} className="text-xs font-medium text-red-600 hover:underline">
            {busy ? "…" : `Confirm ${mode === "repair" ? "under repair" : "lost"}`}
          </button>
          <button type="button" onClick={() => setMode("idle")} className="text-xs text-ink-400 hover:text-ink-600">
            Cancel
          </button>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </form>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "IN_WAREHOUSE" && (
        <button onClick={() => setMode("checkout")} className="text-xs font-medium text-brand-600 hover:underline">
          Checkout to project
        </button>
      )}
      {status === "ON_SITE" && (
        <>
          <button onClick={() => act("RETURN_TO_WAREHOUSE")} disabled={busy} className="text-xs font-medium text-emerald-600 hover:underline">
            Return to warehouse
          </button>
          <button onClick={() => setMode("transfer")} className="text-xs font-medium text-brand-600 hover:underline">
            Transfer
          </button>
          <button onClick={() => setMode("repair")} className="text-xs text-amber-600 hover:underline">
            Mark under repair
          </button>
          <button onClick={() => setMode("lost")} className="text-xs text-red-500 hover:underline">
            Mark lost
          </button>
        </>
      )}
      {(status === "UNDER_REPAIR" || status === "LOST") && (
        <button onClick={() => act("MARK_AVAILABLE")} disabled={busy} className="text-xs font-medium text-emerald-600 hover:underline">
          Mark available (repaired)
        </button>
      )}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
