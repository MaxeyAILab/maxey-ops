"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button, Input, Label } from "@/components/ui";

export function ResetPasswordForm() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

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
    const res = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, newPassword: pw }),
    });
    setBusy(false);
    if (res.ok) {
      setDone(true);
    } else {
      setError((await res.json()).error ?? "Failed to reset password");
    }
  }

  if (!token) {
    return (
      <div className="space-y-4 rounded-xl bg-white p-6 text-center shadow-lg">
        <h1 className="text-lg font-bold text-ink-900">Invalid link</h1>
        <p className="text-sm text-ink-500">
          This reset link is missing its token. Request a new one from the sign-in page.
        </p>
        <Link href="/forgot-password" className="inline-block text-sm font-medium text-brand-600 hover:underline">
          Request a new link
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="space-y-4 rounded-xl bg-white p-6 text-center shadow-lg">
        <p className="text-2xl">✓</p>
        <h1 className="text-lg font-bold text-ink-900">Password updated</h1>
        <p className="text-sm text-ink-500">You can now sign in with your new password.</p>
        <Link
          href="/login"
          className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-brand-500 px-6 text-sm font-medium text-white hover:bg-brand-600"
        >
          Go to sign in
        </Link>
      </div>
    );
  }

  return (
    // method="post": if JS hasn't loaded yet, a native submit must never put
    // the password in the URL
    <form method="post" onSubmit={onSubmit} className="space-y-4 rounded-xl bg-white p-6 shadow-lg">
      <div>
        <h1 className="text-lg font-bold text-ink-900">Set a new password</h1>
        <p className="mt-1 text-sm text-ink-500">Choose a new password for your account.</p>
      </div>
      <div>
        <Label htmlFor="newPassword">New password (min 8 characters)</Label>
        <Input id="newPassword" name="newPassword" type="password" required minLength={8} autoComplete="new-password" autoFocus />
      </div>
      <div>
        <Label htmlFor="confirm">Confirm new password</Label>
        <Input id="confirm" name="confirm" type="password" required minLength={8} autoComplete="new-password" />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? "Saving…" : "Reset password"}
      </Button>
    </form>
  );
}
