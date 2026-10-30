"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label, Select } from "@/components/ui";
import { ItemPicker } from "@/components/item-picker";
import { PhotoInput } from "@/components/photo-input";
import type { PickItem } from "@/lib/item-search";

interface Row {
  key: number;
  item: PickItem | null;
  qty: string;
}

/** File a tally-out form: the project, what it is for, and the materials (each with a quantity). Nothing moves until it is approved,
 * verified by the driver and confirmed on site. */
export function NewTallyOutForm({ items, projects }: { items: PickItem[]; projects: { id: string; name: string }[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([{ key: 1, item: null, qty: "" }]);
  const [nextKey, setNextKey] = useState(2);
  const [formKey, setFormKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  const setRow = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setMsg("");
    const fd = new FormData(e.currentTarget);
    const lines = rows.filter((r) => r.item && Number(r.qty) > 0).map((r) => ({ itemId: r.item!.id, qty: Number(r.qty) }));
    if (lines.length === 0) return setError("Add at least one material and its quantity.");
    for (const r of rows) {
      if (r.item && Number(r.qty) > r.item.qty + 1e-9) return setError(`${r.item.name}: only ${r.item.qty} available to promise.`);
    }
    setBusy(true);
    const res = await fetch("/api/tally-outs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientUuid: crypto.randomUUID(), projectId: fd.get("projectId"), note: fd.get("note"), items: lines }),
    });
    setBusy(false);
    if (!res.ok) return setError(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Could not file the form");
    setRows([{ key: nextKey, item: null, qty: "" }]);
    setNextKey((k) => k + 1);
    setFormKey((k) => k + 1);
    (e.target as HTMLFormElement).reset?.();
    setMsg("Tally-out filed. Nothing leaves the warehouse until it is approved, the driver verifies it and the receiver confirms it on site.");
    router.refresh();
  }

  return (
    <form key={formKey} onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="to-project">Project the materials are going to</Label>
          <Select id="to-project" name="projectId" required defaultValue="">
            <option value="" disabled>
              Choose a project…
            </option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="to-note">What it is for / where it goes (optional)</Label>
          <Input id="to-note" name="note" maxLength={300} placeholder="e.g. ground-floor plumbing, deliver to the gate" />
        </div>
      </div>

      <div className="space-y-3">
        {rows.map((r, i) => (
          <div key={r.key} className="grid gap-2 rounded-lg border border-ink-100 p-3 sm:grid-cols-[1fr_8rem_auto] sm:items-end">
            <div>
              <Label>{i === 0 ? "Material" : `Material ${i + 1}`}</Label>
              <ItemPicker id={`to-item-${r.key}`} name={`item-${r.key}`} items={items} qtyNote="available" onChange={(item) => setRow(r.key, { item })} />
            </div>
            <div>
              <Label htmlFor={`to-qty-${r.key}`}>Quantity{r.item ? ` (${r.item.unit})` : ""}</Label>
              <Input id={`to-qty-${r.key}`} type="number" min="0.01" step="0.01" inputMode="decimal" value={r.qty} onChange={(e) => setRow(r.key, { qty: e.target.value })} />
            </div>
            {rows.length > 1 && (
              <button type="button" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} className="pb-2 text-xs text-red-600 hover:underline">
                Remove
              </button>
            )}
            {r.item && Number(r.qty) > r.item.qty && <p className="text-xs text-red-600 sm:col-span-3">Only {r.item.qty} {r.item.unit} available to promise.</p>}
          </div>
        ))}
        <button
          type="button"
          onClick={() => {
            setRows((rs) => [...rs, { key: nextKey, item: null, qty: "" }]);
            setNextKey((k) => k + 1);
          }}
          className="text-sm font-medium text-brand-600 hover:underline"
        >
          + Add another material
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy}>
          {busy ? "Filing…" : "File tally-out form"}
        </Button>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {msg && <p className="text-sm text-emerald-700">{msg}</p>}
      </div>
    </form>
  );
}

interface Line {
  itemId: string;
  name: string;
  unit: string;
  qty: number;
}

export interface TallyActionProps {
  id: string;
  number: string;
  status: string;
  lines: Line[];
  /** what the driver counted, once verified */
  counted: Record<string, number>;
  receiverId: string | null;
  can: { approve: boolean; reject: boolean; cancel: boolean; verify: boolean; confirm: boolean };
  staff: { id: string; name: string }[];
  myName: string;
  disputed: boolean;
}

/** The next step of a tally-out form, shown to the person who can take it. */
export function TallyOutActions(p: TallyActionProps) {
  const router = useRouter();
  const [open, setOpen] = useState<"" | "reject" | "verify" | "confirm" | "dispute">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const [driverName, setDriverName] = useState(p.myName);
  const [receiverId, setReceiverId] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [counted, setCounted] = useState<Record<string, string>>(Object.fromEntries(p.lines.map((l) => [l.itemId, String(l.qty)])));
  const [received, setReceived] = useState<Record<string, string>>(Object.fromEntries(p.lines.map((l) => [l.itemId, String(p.counted[l.itemId] ?? l.qty)])));
  const [photos, setPhotos] = useState<string[]>([]);

  async function send(body: object, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setError("");
    const res = await fetch(`/api/tally-outs/${p.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (!res.ok) return setError(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Failed");
    setOpen("");
    router.refresh();
  }

  const nothing = !p.can.approve && !p.can.reject && !p.can.cancel && !p.can.verify && !p.can.confirm;
  if (nothing) return null;

  return (
    <div className="mt-3 space-y-3 border-t border-ink-100 pt-3">
      <div className="flex flex-wrap items-center gap-2">
        {p.can.approve && p.status === "PENDING" && (
          <Button type="button" disabled={busy} onClick={() => send({ action: "approve" }, `Approve ${p.number}? The quantities stay reserved; nothing moves until the driver verifies it and the receiver confirms it.`)}>
            Approve
          </Button>
        )}
        {p.can.reject && (p.status === "PENDING" || p.status === "APPROVED") && (
          <Button type="button" variant="secondary" disabled={busy} onClick={() => setOpen(open === "reject" ? "" : "reject")}>
            Reject
          </Button>
        )}
        {p.can.verify && p.status === "APPROVED" && (
          <Button type="button" disabled={busy} onClick={() => setOpen(open === "verify" ? "" : "verify")}>
            Verify the load
          </Button>
        )}
        {p.can.confirm && p.status === "VERIFIED" && (
          <>
            <Button type="button" disabled={busy} onClick={() => setOpen(open === "confirm" ? "" : "confirm")}>
              Confirm received
            </Button>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => setOpen(open === "dispute" ? "" : "dispute")}>
              Report a problem
            </Button>
          </>
        )}
        {p.can.cancel && (
          <button type="button" disabled={busy} onClick={() => send({ action: "cancel" }, `Cancel ${p.number}? The reserved materials are freed.`)} className="text-xs text-red-600 hover:underline">
            Cancel this form
          </button>
        )}
      </div>

      {open === "reject" && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[14rem] flex-1">
            <Label htmlFor={`rj-${p.id}`}>Why is it rejected?</Label>
            <Input id={`rj-${p.id}`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
          </div>
          <Button type="button" disabled={busy || reason.trim().length < 3} onClick={() => send({ action: "reject", reason })}>
            Reject form
          </Button>
        </div>
      )}

      {open === "dispute" && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[14rem] flex-1">
            <Label htmlFor={`dp-${p.id}`}>What is wrong?</Label>
            <Input id={`dp-${p.id}`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          </div>
          <Button type="button" disabled={busy || reason.trim().length < 5} onClick={() => send({ action: "dispute", note: reason })}>
            Send report
          </Button>
        </div>
      )}

      {open === "verify" && (
        <div className="space-y-3 rounded-lg bg-ink-50 p-3 dark:bg-transparent">
          <p className="text-xs text-ink-500">Count what is being loaded. You can count less than the form says, never more. Nothing is added to the project yet — the person receiving it confirms that.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor={`dr-${p.id}`}>Driver</Label>
              <Input id={`dr-${p.id}`} value={driverName} onChange={(e) => setDriverName(e.target.value)} maxLength={200} />
            </div>
            <div>
              <Label htmlFor={`rc-${p.id}`}>Who receives it on site</Label>
              <Select id={`rc-${p.id}`} value={receiverId} onChange={(e) => setReceiverId(e.target.value)}>
                <option value="">Someone not in the app (type the name below)</option>
                {p.staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
              {!receiverId && <Input className="mt-2" placeholder="Receiver's name" value={recipientName} onChange={(e) => setRecipientName(e.target.value)} maxLength={200} />}
            </div>
          </div>
          <div className="space-y-2">
            {p.lines.map((l) => (
              <div key={l.itemId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-ink-800">
                  {l.name} <span className="text-ink-400">— form: {l.qty} {l.unit}</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <Input className="w-24" type="number" min="0" max={l.qty} step="0.01" inputMode="decimal" value={counted[l.itemId]} onChange={(e) => setCounted((c) => ({ ...c, [l.itemId]: e.target.value }))} aria-label={`Counted ${l.name}`} />
                  <span className="text-xs text-ink-500">{l.unit} counted</span>
                </span>
              </div>
            ))}
          </div>
          <PhotoInput label="Photo of the load (recommended)" max={4} onChange={setPhotos} />
          <Button
            type="button"
            disabled={busy}
            onClick={() =>
              send({
                action: "verify",
                driverName,
                receiverId,
                recipientName: receiverId ? "" : recipientName,
                checklist: p.lines.map((l) => ({ itemId: l.itemId, countedQty: Number(counted[l.itemId] || 0), ok: Number(counted[l.itemId] || 0) >= l.qty, remarks: "" })),
                photos,
              })
            }
          >
            Mark as verified — on the way
          </Button>
        </div>
      )}

      {open === "confirm" && (
        <div className="space-y-3 rounded-lg bg-ink-50 p-3 dark:bg-transparent">
          <p className="text-xs text-ink-500">Enter what actually arrived. The materials are added to the project's list, and taken out of the warehouse, when you confirm.</p>
          <div className="space-y-2">
            {p.lines.map((l) => (
              <div key={l.itemId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-ink-800">
                  {l.name} <span className="text-ink-400">— driver counted {p.counted[l.itemId] ?? l.qty} {l.unit}</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <Input className="w-24" type="number" min="0" max={p.counted[l.itemId] ?? l.qty} step="0.01" inputMode="decimal" value={received[l.itemId]} onChange={(e) => setReceived((c) => ({ ...c, [l.itemId]: e.target.value }))} aria-label={`Received ${l.name}`} />
                  <span className="text-xs text-ink-500">{l.unit} received</span>
                </span>
              </div>
            ))}
          </div>
          <Button
            type="button"
            disabled={busy}
            onClick={() => send({ action: "confirm", checklist: p.lines.map((l) => ({ itemId: l.itemId, receivedQty: Number(received[l.itemId] || 0), remarks: "" })) }, `Confirm that you received these materials for ${p.number}? They will be added to the project's materials list.`)}
          >
            Confirm — add to the project
          </Button>
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
