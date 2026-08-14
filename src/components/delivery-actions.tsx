"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Owner-only correction tool — removes a mistaken/test delivery verification. */
export function DeleteDeliveryButton({ deliveryId, poNumber }: { deliveryId: string; poNumber: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onDelete() {
    if (
      !confirm(
        `Delete this delivery for ${poNumber}? The PO's status will revert to reflect what's left. This cannot be undone.`
      )
    ) {
      return;
    }
    setBusy(true);
    const res = await fetch(`/api/deliveries/${deliveryId}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) {
      router.refresh();
    } else {
      alert((await res.json()).error ?? "Failed to delete");
    }
  }

  return (
    <button
      type="button"
      onClick={onDelete}
      disabled={busy}
      className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
    >
      {busy ? "Deleting…" : "Delete"}
    </button>
  );
}
