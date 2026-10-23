"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { submitOrQueue } from "@/lib/outbox";
import { Button, Input, Label, Select } from "@/components/ui";
import { PhotoInput } from "@/components/photo-input";
import { TOOL_CONDITIONS, TOOL_CONDITION_LABEL, type ToolConditionValue } from "@/lib/tool-condition";
import { WAREHOUSES, type WarehouseValue } from "@/lib/warehouses";
import { TOOL_CATEGORIES } from "@/lib/tool-category";

interface ProjectOption {
  id: string;
  name: string;
}

/** Register a new tool/equipment asset — starts in one of the four warehouses, the one being looked at (Spec 6.4). */
export function AddToolForm({ warehouse = "MAIN" }: { warehouse?: WarehouseValue }) {
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
        workingStatus: fd.get("workingStatus"),
        warehouse: fd.get("warehouse"),
      }),
    });
    setBusy(false);
    if (res.ok) {
      (e.target as HTMLFormElement).reset?.();
      router.refresh();
    } else setError((await res.json()).error ?? "Failed to add tool");
  }

  return (
    <form key={warehouse} onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-5">
      <div className="sm:col-span-5">
        <Label htmlFor="toolWarehouse">Add it to</Label>
        <Select id="toolWarehouse" name="warehouse" defaultValue={warehouse}>
          {WAREHOUSES.map((w) => (
            <option key={w.value} value={w.value}>
              {w.label}
            </option>
          ))}
        </Select>
      </div>
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
        <Select id="toolCategory" name="category" required defaultValue="">
          <option value="" disabled>
            Choose a category…
          </option>
          {TOOL_CATEGORIES.map((c) => (
            <option key={c.value} value={c.label}>
              {c.label}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="toolStatus">Status</Label>
        <Select id="toolStatus" name="workingStatus" defaultValue="WORKING">
          {TOOL_CONDITIONS.map((c) => (
            <option key={c} value={c}>
              {TOOL_CONDITION_LABEL[c]}
            </option>
          ))}
        </Select>
      </div>
      {error && <p className="text-sm text-red-600 sm:col-span-5">{error}</p>}
      <div className="sm:col-span-5">
        <Button type="submit" variant="secondary" disabled={busy}>
          {busy ? "Adding…" : "+ Add tool / equipment"}
        </Button>
      </div>
    </form>
  );
}

type Mode = "idle" | "checkout" | "transfer" | "return" | "repair" | "lost";

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
  pending,
}: {
  toolId: string;
  status: "IN_WAREHOUSE" | "ON_SITE" | "UNDER_REPAIR" | "LOST";
  currentProjectId: string | null;
  projects: ProjectOption[];
  /** set while a return/transfer request for this tool is waiting for approval: says who asked */
  pending?: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [proof, setProof] = useState<string[]>([]); // photos of the tool being returned / transferred

  const transferTargets = projects.filter((p) => p.id !== currentProjectId);

  // While a request is waiting, the tool stays where it is and nothing else can be asked of it.
  if (pending) return <span className="text-xs font-medium text-amber-700">⏳ {pending}</span>;

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
    setProof([]);
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
            ...(mode === "transfer" ? { photos: proof } : {}),
          });
        }}
        className={mode === "transfer" ? "space-y-2 rounded-lg bg-ink-50 p-2" : "flex items-center gap-2"}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Select name="toProjectId" required className="min-h-[32px] py-0 text-xs">
            {(mode === "checkout" ? projects : transferTargets).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <button type="submit" disabled={busy} className="text-xs font-medium text-brand-600 hover:underline">
            {busy ? "…" : mode === "checkout" ? "Confirm" : "Send request"}
          </button>
          <button type="button" onClick={() => setMode("idle")} className="text-xs text-ink-400 hover:text-ink-600">
            Cancel
          </button>
          {error && <span className="text-xs text-red-600">{error}</span>}
        </div>
        {mode === "transfer" && <PhotoInput label="Photo of the tool (recommended — the approver sees it)" max={4} onChange={setProof} />}
      </form>
    );
  }

  if (mode === "return") {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          act("RETURN_TO_WAREHOUSE", { photos: proof });
        }}
        className="space-y-2 rounded-lg bg-ink-50 p-2"
      >
        <PhotoInput label="Photo of the tool being returned (recommended — the approver sees it)" max={4} onChange={setProof} />
        <div className="flex items-center gap-3">
          <button type="submit" disabled={busy} className="text-xs font-medium text-emerald-600 hover:underline">
            {busy ? "…" : "Send return request"}
          </button>
          <button type="button" onClick={() => setMode("idle")} className="text-xs text-ink-400 hover:text-ink-600">
            Cancel
          </button>
          {error && <span className="text-xs text-red-600">{error}</span>}
        </div>
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
          <button onClick={() => setMode("return")} title="Office staff approve it before the tool is back in the warehouse" className="text-xs font-medium text-emerald-600 hover:underline">
            Return to warehouse (request)
          </button>
          <button onClick={() => setMode("transfer")} title="Office staff approve it before the tool moves" className="text-xs font-medium text-brand-600 hover:underline">
            Transfer (request)
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

const CONDITION_TONE: Record<ToolConditionValue, string> = {
  WORKING: "border-teal-300 bg-teal-50 text-teal-800",
  FOR_REPAIR: "border-amber-300 bg-amber-50 text-amber-800",
  NOT_WORKING: "border-red-300 bg-red-50 text-red-800",
  FOR_DISPOSAL: "border-ink-300 bg-ink-100 text-ink-700",
};

/** How the tool is doing — working, for repair, not working, for disposal. Anyone who logs movements can change it; it is recorded who did. */
export function ToolConditionControl({ toolId, value }: { toolId: string; value: ToolConditionValue }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function change(next: string) {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/tools/${toolId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workingStatus: next }) });
    setBusy(false);
    if (res.ok) router.refresh();
    else setError(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Couldn't change it");
  }

  return (
    <div>
      <select
        aria-label="Condition"
        value={value}
        disabled={busy}
        onChange={(e) => change(e.target.value)}
        className={`min-h-[30px] rounded-md border px-2 text-xs font-medium disabled:opacity-60 ${CONDITION_TONE[value]}`}
      >
        {TOOL_CONDITIONS.map((c) => (
          <option key={c} value={c}>
            {TOOL_CONDITION_LABEL[c]}
          </option>
        ))}
      </select>
      {error && <p className="mt-0.5 text-[11px] text-red-600">{error}</p>}
    </div>
  );
}

/** Remove a tool/equipment entry typed in wrongly. The Owner can remove any; others only one that has never moved. */
export function DeleteToolButton({ toolId, name, movements }: { toolId: string; name: string; movements: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function remove() {
    const detail = movements > 0 ? `\n\nThis also removes its ${movements} logged movement${movements === 1 ? "" : "s"}.` : "";
    if (!window.confirm(`Delete “${name}” from Tools & Equipment?${detail}\n\nThis can't be undone (the audit log keeps a record).`)) return;
    setBusy(true);
    setError("");
    const res = await fetch(`/api/tools/${toolId}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) router.refresh();
    else setError(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Couldn't delete it");
  }

  return (
    <span>
      <button type="button" onClick={remove} disabled={busy} aria-label={`Delete ${name}`} className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50">
        {busy ? "…" : "Delete"}
      </button>
      {error && <span className="ml-2 text-xs text-red-600">{error}</span>}
    </span>
  );
}
