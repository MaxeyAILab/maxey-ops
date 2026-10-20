"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/lang-provider";
import type { I18nKey } from "@/lib/i18n";

const HAPTICS_KEY = "maxey_haptics";
const TOAST_EVENT = "app-toast";

type Kind = "ok" | "error" | "info";
interface ToastDetail {
  text: string;
  kind: Kind;
}

export const hapticsOn = () => {
  try {
    return localStorage.getItem(HAPTICS_KEY) !== "off";
  } catch {
    return true;
  }
};
export const setHaptics = (on: boolean) => {
  try {
    localStorage.setItem(HAPTICS_KEY, on ? "on" : "off");
  } catch {
    // storage blocked — the setting just isn't remembered
  }
};

/** A short buzz (Android phones and browsers that support it; iPhones ignore it). */
export function haptic(kind: "tap" | "ok" | "error" = "tap") {
  if (typeof navigator === "undefined" || !("vibrate" in navigator) || !hapticsOn()) return;
  navigator.vibrate(kind === "error" ? [30, 60, 30] : kind === "ok" ? 18 : 8);
}

/** Show a toast from anywhere in the app (the text should already be in the person's language). */
export function toast(text: string, kind: Kind = "ok") {
  window.dispatchEvent(new CustomEvent<ToastDetail>(TOAST_EVENT, { detail: { text, kind } }));
}

// Calls that already tell the person what happened in their own way, or that happen in the background.
const QUIET = ["/api/auth", "/api/push", "/api/notifications", "/api/search", "/api/account", "/api/cron"];

function verbKey(method: string, action: unknown): I18nKey {
  switch (action) {
    case "approve":
    case "approve_answer":
      return "toast.approved";
    case "reject":
      return "toast.rejected";
    case "release":
      return "toast.released";
    case "verify":
      return "toast.verified";
    default:
      return method === "DELETE" ? "toast.deleted" : method === "PATCH" ? "toast.updated" : "toast.saved";
  }
}

/**
 * After anything is saved the person sees a small "Saved" message and feels a short buzz — on every screen, without each
 * form having to remember to do it. It watches the app's own save requests (not page loads), and shows the server's
 * reason when one doesn't go through.
 */
export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const t = useT();
  const tRef = useRef(t);
  tRef.current = t;
  const [current, setCurrent] = useState<(ToastDetail & { id: number }) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const seq = useRef(0);

  useEffect(() => {
    const show = (d: ToastDetail) => {
      const id = ++seq.current;
      setCurrent({ ...d, id });
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCurrent((c) => (c?.id === id ? null : c)), d.kind === "error" ? 4500 : 2400);
      haptic(d.kind === "error" ? "error" : d.kind === "ok" ? "ok" : "tap");
    };
    const onToast = (e: Event) => show((e as CustomEvent<ToastDetail>).detail);
    window.addEventListener(TOAST_EVENT, onToast);

    const original = window.fetch;
    const wrapped: typeof window.fetch = async (input, init) => {
      const res = await original.call(window, input, init);
      try {
        const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
        if (method !== "GET" && method !== "HEAD") {
          const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, window.location.origin);
          if (url.origin === window.location.origin && url.pathname.startsWith("/api/") && !QUIET.some((p) => url.pathname.startsWith(p))) {
            if (res.ok) {
              let action: unknown;
              if (typeof init?.body === "string") {
                try {
                  action = (JSON.parse(init.body) as { action?: unknown }).action;
                } catch {
                  // not JSON — fine
                }
              }
              show({ text: tRef.current(verbKey(method, action)), kind: "ok" });
            } else if (res.status !== 409 && res.status !== 401) {
              // 409 is a replay the server already has (offline sync) — nothing to report
              const message = await res
                .clone()
                .json()
                .then((j: { error?: string }) => j.error)
                .catch(() => undefined);
              show({ text: message ? `${tRef.current("toast.failed")}: ${message}` : tRef.current("toast.failed"), kind: "error" });
            }
          }
        }
      } catch {
        // feedback must never get in the way of the request itself
      }
      return res;
    };
    window.fetch = wrapped;
    return () => {
      window.removeEventListener(TOAST_EVENT, onToast);
      if (window.fetch === wrapped) window.fetch = original;
      clearTimeout(timer.current);
    };
  }, []);

  return (
    <>
      {children}
      <div
        aria-live="polite"
        role="status"
        className="toast-pos no-print pointer-events-none fixed inset-x-0 z-[60] flex justify-center px-4"
      >
        {current && (
          <div
            key={current.id}
            className={`max-w-sm rounded-full px-4 py-2 text-sm font-medium text-white shadow-lg ${
              current.kind === "error" ? "bg-red-700" : current.kind === "ok" ? "bg-emerald-700" : "bg-ink-800"
            }`}
          >
            {current.kind === "ok" ? "✓ " : ""}
            {current.text}
          </div>
        )}
      </div>
    </>
  );
}
