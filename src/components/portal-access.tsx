"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label } from "@/components/ui";

/**
 * Project page "Portal Access" panel: create the client's portal login.
 * The temporary password is shown exactly once — copy it and send it to the
 * client; they must change it on first sign-in.
 */
export function CreatePortalAccessForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [issued, setIssued] = useState<{ email: string; tempPassword: string } | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const fd = new FormData(e.currentTarget);
    const res = await fetch(`/api/projects/${projectId}/portal-access`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: fd.get("email"),
        contactName: fd.get("contactName"),
      }),
    });
    setBusy(false);
    if (res.ok) {
      const j = await res.json();
      setIssued({ email: j.email, tempPassword: j.tempPassword });
      router.refresh();
    } else {
      setError((await res.json()).error ?? "Failed to create portal access");
    }
  }

  if (issued) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm">
        <p className="font-semibold text-emerald-800">Portal login created ✓</p>
        <p className="mt-2 text-emerald-900">
          Send these to the client — the temporary password is shown only once:
        </p>
        <div className="mt-2 rounded-lg bg-white p-3 font-mono text-sm text-ink-800">
          <div>Portal: {typeof window !== "undefined" ? window.location.origin : ""}/login</div>
          <div>Email: {issued.email}</div>
          <div>Temporary password: {issued.tempPassword}</div>
        </div>
        <p className="mt-2 text-xs text-emerald-700">
          They will be required to set their own password on first sign-in.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="paEmail">Client email *</Label>
          <Input id="paEmail" name="email" type="email" required />
        </div>
        <div>
          <Label htmlFor="paName">Contact person (optional)</Label>
          <Input id="paName" name="contactName" placeholder="defaults to client record" />
        </div>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" variant="secondary" disabled={busy}>
        {busy ? "Creating…" : "Create client login"}
      </Button>
    </form>
  );
}

/** Deactivate / reactivate an account inline (used on project page + People). */
export function AccountToggleButton({
  userId,
  name,
  active,
}: {
  userId: string;
  name: string;
  active: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    const action = active ? "deactivate" : "reactivate";
    if (
      active &&
      !confirm(
        `Deactivate ${name}'s access? Their history is kept and access can be restored anytime.`
      )
    ) {
      return;
    }
    setBusy(true);
    const res = await fetch(`/api/people/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    setBusy(false);
    if (!res.ok) alert((await res.json()).error ?? "Failed");
    router.refresh();
  }

  return (
    <button
      onClick={toggle}
      disabled={busy}
      className={`rounded px-2 py-1 text-xs disabled:opacity-50 ${
        active ? "text-red-500 hover:bg-red-50" : "text-emerald-600 hover:bg-emerald-50"
      }`}
    >
      {busy ? "…" : active ? "Deactivate" : "Reactivate"}
    </button>
  );
}

/** Issue a fresh temporary password (shown once). */
export function ResetPasswordButton({ userId, name }: { userId: string; name: string }) {
  const [busy, setBusy] = useState(false);
  const [temp, setTemp] = useState("");

  async function reset() {
    if (!confirm(`Issue a new temporary password for ${name}? Their current password stops working.`))
      return;
    setBusy(true);
    const res = await fetch(`/api/people/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reset-password" }),
    });
    setBusy(false);
    if (res.ok) setTemp((await res.json()).tempPassword);
    else alert((await res.json()).error ?? "Failed");
  }

  if (temp) {
    return (
      <span className="rounded bg-amber-50 px-2 py-1 font-mono text-xs text-amber-800">
        temp: {temp}
      </span>
    );
  }
  return (
    <button
      onClick={reset}
      disabled={busy}
      className="rounded px-2 py-1 text-xs text-ink-500 hover:bg-ink-100 disabled:opacity-50"
    >
      {busy ? "…" : "Reset password"}
    </button>
  );
}
