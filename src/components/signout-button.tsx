"use client";

import { signOut } from "next-auth/react";

export function SignOutButton() {
  return (
    <button
      onClick={() => signOut({ callbackUrl: "/login" })}
      className="rounded-lg border border-ink-200 px-2.5 py-1.5 text-xs font-medium text-ink-600 hover:bg-ink-50"
    >
      Sign out
    </button>
  );
}
