"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Label } from "@/components/ui";

// Deliberately not using the shared Input/Button primitives here — this page
// keeps the original burgundy accent while the rest of the app moved to the
// new teal theme, and those primitives now render teal.
const inputClass =
  "block min-h-[44px] w-full rounded-lg border border-ink-200 bg-white px-3 text-sm text-ink-900 placeholder:text-ink-400 focus:border-[#8a1a28] focus:outline-none focus:ring-1 focus:ring-[#8a1a28]";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const fd = new FormData(e.currentTarget);
    const res = await signIn("credentials", {
      email: fd.get("email"),
      password: fd.get("password"),
      redirect: false,
    });
    setBusy(false);
    if (res?.error) {
      setError("Invalid email or password.");
      return;
    }
    router.push(params.get("callbackUrl") ?? "/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-xl bg-white p-6 shadow-lg">
      <div>
        <Label htmlFor="email">Email</Label>
        <input id="email" name="email" type="email" required autoComplete="email" className={inputClass} />
      </div>
      <div>
        <div className="flex items-center justify-between">
          <Label htmlFor="password" className="mb-0">
            Password
          </Label>
          <Link href="/forgot-password" className="text-xs font-medium text-[#6e1420] hover:underline">
            Forgot password?
          </Link>
        </div>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className={inputClass}
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-[#8a1a28] px-4 text-sm font-medium text-white transition-colors hover:bg-[#6e1420] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8a1a28] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
      >
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
