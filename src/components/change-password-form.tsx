"use client";

import { useState } from "react";
import { Button, Input, Label } from "@/components/ui";

export function ChangePasswordForm({
  required,
  destination,
}: {
  required: boolean;
  destination: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const fd = new FormData(e.currentTarget);
    const pw = String(fd.get("newPassword") ?? "");
    if (pw.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (pw !== fd.get("confirm")) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/account/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newPassword: pw }),
    });
    if (res.ok) {
      // Hard navigation, not router.push: the auth-guarded destination may have
      // a cached "redirect back here" entry in the client Router Cache from the
      // pre-change state. A full page load bypasses that cache and re-runs the
      // layout guard against the now-updated DB flag.
      window.location.assign(destination);
      return;
    }
    setBusy(false);
    setError((await res.json()).error ?? "Failed to set password");
  }

  return (
    // method="post": if JS hasn't loaded yet, a native submit must never put
    // the password in the URL
    <form method="post" onSubmit={onSubmit} className="space-y-4 rounded-xl bg-white p-6 shadow-lg">
      <div>
        <h1 className="text-lg font-bold text-ink-900">Set your password</h1>
        <p className="mt-1 text-sm text-ink-500">
          {required
            ? "You signed in with a temporary password. Choose your own to continue."
            : "Choose a new password for your account."}
        </p>
      </div>
      <div>
        <Label htmlFor="newPassword">New password (min 8 characters)</Label>
        <Input id="newPassword" name="newPassword" type="password" required minLength={8} autoComplete="new-password" />
      </div>
      <div>
        <Label htmlFor="confirm">Confirm new password</Label>
        <Input id="confirm" name="confirm" type="password" required minLength={8} autoComplete="new-password" />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? "Saving…" : "Save and continue"}
      </Button>
    </form>
  );
}
