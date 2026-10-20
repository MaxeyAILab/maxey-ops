"use client";

import { signOut } from "next-auth/react";
import { disablePush } from "@/lib/push-client";

export function SignOutButton() {
  return (
    <button
      onClick={async () => {
        // Stop this phone receiving the signed-out person's alerts (matters on a shared phone). Best effort — never blocks sign-out.
        await Promise.race([disablePush(), new Promise((resolve) => setTimeout(resolve, 1500))]).catch(() => undefined);
        await signOut({ callbackUrl: "/login" });
      }}
      className="rounded-lg border border-ink-200 px-2.5 py-1.5 text-xs font-medium text-ink-600 hover:bg-ink-50"
    >
      Sign out
    </button>
  );
}
