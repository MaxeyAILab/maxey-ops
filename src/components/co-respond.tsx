"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";

/**
 * Client in-portal approve/reject for change orders (Spec 6.8) —
 * click-to-approve with server-side timestamp + attribution.
 */
export function ChangeOrderRespond({ changeOrderId }: { changeOrderId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState<"APPROVED" | "REJECTED" | null>(null);

  async function respond(decision: "APPROVED" | "REJECTED") {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/change-orders/${changeOrderId}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    setBusy(false);
    if (res.ok) router.refresh();
    else setError((await res.json()).error ?? "Failed to submit response");
  }

  if (confirming) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-ink-700">
          {confirming === "APPROVED"
            ? "By approving, you authorize this additional work including its cost and schedule impact. This is recorded with your name and a timestamp."
            : "Reject this change order? This is recorded with your name and a timestamp."}
        </p>
        <div className="flex gap-2">
          <Button
            variant={confirming === "APPROVED" ? "success" : "danger"}
            disabled={busy}
            onClick={() => respond(confirming)}
          >
            {busy ? "Submitting…" : `Yes, ${confirming === "APPROVED" ? "approve" : "reject"}`}
          </Button>
          <Button variant="ghost" onClick={() => setConfirming(null)}>
            Cancel
          </Button>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <Button variant="success" onClick={() => setConfirming("APPROVED")}>
        ✓ Approve
      </Button>
      <Button variant="secondary" onClick={() => setConfirming("REJECTED")}>
        Reject
      </Button>
    </div>
  );
}
