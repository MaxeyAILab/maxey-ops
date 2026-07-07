"use client";

import { useEffect } from "react";
import { flush } from "@/lib/outbox";

export function SwRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      if (process.env.NODE_ENV === "production") {
        navigator.serviceWorker.register("/sw.js").catch(() => {});
      } else {
        // Dev: a live SW serves stale build chunks after rebuilds — remove it
        navigator.serviceWorker.getRegistrations().then((regs) => {
          regs.forEach((r) => r.unregister());
        });
        if ("caches" in window) {
          caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
        }
      }
    }
    // Opportunistic flush on load in case items queued in a previous session
    flush().catch(() => {});
  }, []);
  return null;
}
