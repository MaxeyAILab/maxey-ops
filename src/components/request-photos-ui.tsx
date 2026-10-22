"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PhotoInput } from "@/components/photo-input";
import { PhotoThumbnails } from "@/components/photo-viewer";
import { MAX_REQUEST_PHOTOS } from "@/lib/request-photos";

/**
 * The photos on a return / transfer request, shown on the card the approver decides on — so they can see what is being moved
 * before approving. While the request waits, the person who asked and whoever approves can add more (a few clear shots of the
 * items). A request without a photo says so.
 */
export function RequestPhotos({ kind, id, photos, label, canAdd }: { kind: "stock" | "tool"; id: string; photos: string[]; label: string; canAdd: boolean }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [fresh, setFresh] = useState<string[]>([]);
  const [pickerKey, setPickerKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const room = Math.max(0, MAX_REQUEST_PHOTOS - photos.length);
  const url = kind === "stock" ? `/api/inventory/movements/${id}` : `/api/tools/movements/${id}`;

  async function attach() {
    if (fresh.length === 0) return;
    setBusy(true);
    setError("");
    const res = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "add_photos", photos: fresh }) });
    setBusy(false);
    if (!res.ok) return setError(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Couldn't attach the photo");
    setAdding(false);
    setFresh([]);
    setPickerKey((k) => k + 1);
    router.refresh();
  }

  return (
    <div className="mt-2 space-y-2">
      {photos.length > 0 ? <PhotoThumbnails photos={photos.map((src) => ({ src, label }))} /> : <p className="text-xs font-medium text-amber-700">No photo of the items was attached</p>}
      {canAdd && room > 0 && !adding && (
        <button type="button" onClick={() => setAdding(true)} className="text-xs font-medium text-brand-600 hover:underline">
          📷 {photos.length > 0 ? "Add another photo" : "Add a photo"}
        </button>
      )}
      {adding && (
        <div className="space-y-2 rounded-lg border border-dashed border-ink-200 p-2">
          <PhotoInput key={pickerKey} label="Photo of the items" max={Math.min(4, room)} onChange={setFresh} />
          <div className="flex items-center gap-3">
            <button type="button" disabled={busy || fresh.length === 0} onClick={attach} className="rounded-md bg-[#8a1a28] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#741522] disabled:opacity-50">
              {busy ? "Attaching…" : "Attach"}
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setFresh([]);
                setPickerKey((k) => k + 1);
              }}
              className="text-xs text-ink-500 hover:underline"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
