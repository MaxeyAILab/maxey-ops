"use client";

import { useCallback, useEffect, useState } from "react";
import { flush, pendingCount } from "@/lib/outbox";

/**
 * Visible sync indicator (Spec §4): pending-item count on every relevant
 * screen, with a manual "Sync now" fallback.
 */
export function SyncStatus({ compact = false }: { compact?: boolean }) {
  const [count, setCount] = useState(0);
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(() => {
    pendingCount().then(setCount).catch(() => {});
  }, []);

  const syncNow = useCallback(async () => {
    setSyncing(true);
    try {
      await flush();
    } finally {
      setSyncing(false);
      refresh();
    }
  }, [refresh]);

  useEffect(() => {
    setOnline(navigator.onLine);
    refresh();
    const onOnline = () => {
      setOnline(true);
      syncNow();
    };
    const onOffline = () => setOnline(false);
    const onChange = () => refresh();
    const onSwMsg = (e: MessageEvent) => {
      if (e.data?.type === "outbox-synced") refresh();
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("outbox-change", onChange);
    navigator.serviceWorker?.addEventListener("message", onSwMsg);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("outbox-change", onChange);
      navigator.serviceWorker?.removeEventListener("message", onSwMsg);
    };
  }, [refresh, syncNow]);

  if (compact) {
    // phone top bar: just the dot, plus the number waiting (tap it to send now)
    const tone = online && count === 0 ? "bg-emerald-500" : online ? "bg-amber-400" : "bg-red-500";
    return (
      <button
        type="button"
        onClick={count > 0 && online ? syncNow : undefined}
        aria-label={count > 0 ? `${count} item${count === 1 ? "" : "s"} pending sync${online ? " — tap to sync now" : " (offline)"}` : online ? "Synced" : "Offline"}
        className="inline-flex items-center gap-1 px-1 text-xs"
      >
        <span className={`h-2.5 w-2.5 rounded-full ${tone} ${syncing ? "animate-pulse" : ""}`} />
        {count > 0 && <span className="font-semibold text-amber-700">{count}</span>}
      </button>
    );
  }

  if (online && count === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-ink-400">
        <span className="h-2 w-2 rounded-full bg-emerald-500" />
        Synced
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2 text-xs">
      <span
        className={`h-2 w-2 rounded-full ${online ? "bg-amber-400" : "bg-red-500"}`}
      />
      <span className={online ? "text-amber-600" : "text-red-600"}>
        {online ? "" : "Offline — "}
        {count > 0 ? `${count} item${count === 1 ? "" : "s"} pending sync` : "Online"}
      </span>
      {count > 0 && online && (
        <button
          onClick={syncNow}
          disabled={syncing}
          className="rounded border border-ink-200 px-2 py-0.5 text-xs font-medium text-ink-600 hover:bg-ink-50 disabled:opacity-50"
        >
          {syncing ? "Syncing…" : "Sync now"}
        </button>
      )}
    </span>
  );
}
