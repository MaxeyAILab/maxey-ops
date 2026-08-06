"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, Input, Label } from "@/components/ui";

export function ForgotPasswordForm() {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const fd = new FormData(e.currentTarget);
    await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: fd.get("email") }),
    }).catch(() => null);
    setBusy(false);
    // Always show the same confirmation, whether or not the email exists —
    // this page never reveals which accounts are registered.
    setDone(true);
  }

  if (done) {
    return (
      <div className="space-y-4 rounded-xl bg-white p-6 text-center shadow-lg">
        <p className="text-2xl">📬</p>
        <h1 className="text-lg font-bold text-ink-900">Check your email</h1>
        <p className="text-sm text-ink-500">
          If an account exists for that email, we&apos;ve sent a link to reset your password.
          It expires in 30 minutes.
        </p>
        <Link href="/login" className="inline-block text-sm font-medium text-brand-600 hover:underline">
          ← Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form method="post" onSubmit={onSubmit} className="space-y-4 rounded-xl bg-white p-6 shadow-lg">
      <div>
        <h1 className="text-lg font-bold text-ink-900">Forgot your password?</h1>
        <p className="mt-1 text-sm text-ink-500">
          Enter your account email and we&apos;ll send you a reset link.
        </p>
      </div>
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required autoComplete="email" autoFocus />
      </div>
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? "Sending…" : "Send reset link"}
      </Button>
      <Link href="/login" className="block text-center text-sm font-medium text-ink-500 hover:text-ink-700">
        ← Back to sign in
      </Link>
    </form>
  );
}
