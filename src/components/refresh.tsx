"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/components/lang-provider";
import { haptic } from "@/components/feedback-provider";

/** Redraws the page with the latest data (no full reload) and tells the person it's working. */
function useRefresh() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [spinning, setSpinning] = useState(false);
  const run = () => {
    setSpinning(true);
    haptic("tap");
    start(() => router.refresh());
    // keep the spinner up for a moment even when the data comes back instantly, so the tap visibly did something
    setTimeout(() => setSpinning(false), 700);
  };
  return { run, busy: pending || spinning };
}

/** The ⟳ button beside the bell. */
export function RefreshButton() {
  const t = useT();
  const { run, busy } = useRefresh();
  return (
    <button
      type="button"
      onClick={run}
      disabled={busy}
      aria-label={busy ? t("chrome.refreshing") : t("chrome.refresh")}
      title={t("chrome.refresh")}
      className="rounded-lg border border-ink-200 px-2 py-1.5 text-xs text-ink-600 hover:bg-ink-50 disabled:opacity-70"
    >
      <span aria-hidden className={`inline-block ${busy ? "animate-spin" : ""}`}>
        ⟳
      </span>
    </button>
  );
}

const TRIGGER = 72; // px of pull that counts
const MAX_PULL = 110;

/**
 * Pull the page down from the top to refresh it, like any phone app. Phones only (the page is scrolled to the very top,
 * nothing is open on top of it). Installed apps have no browser refresh, so this is how people reload on them.
 */
export function PullToRefresh() {
  const t = useT();
  const { run, busy } = useRefresh();
  const [pull, setPull] = useState(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const pullRef = useRef(0);
  const runRef = useRef(run);
  runRef.current = run;

  useEffect(() => {
    const phone = () => window.matchMedia("(max-width: 767px)").matches;
    const reset = () => {
      start.current = null;
      pullRef.current = 0;
      setPull(0);
    };
    const down = (e: TouchEvent) => {
      const target = e.target as HTMLElement | null;
      const blocked =
        !phone() ||
        window.scrollY > 0 ||
        document.body.style.overflow === "hidden" || // a menu or picture is open
        !!target?.closest?.("input, textarea, select, [data-no-pull], [data-menu-swipe]" /* the top bar pulls the menu down instead */);
      start.current = blocked ? null : { x: e.touches[0].clientX, y: e.touches[0].clientY };
    };
    const move = (e: TouchEvent) => {
      const s = start.current;
      if (!s) return;
      const dy = e.touches[0].clientY - s.y;
      const dx = e.touches[0].clientX - s.x;
      if (dy <= 0 || Math.abs(dx) > dy) {
        if (pullRef.current) reset();
        return;
      }
      if (window.scrollY > 0) return reset();
      pullRef.current = Math.min(MAX_PULL, dy * 0.5);
      setPull(pullRef.current);
    };
    const up = () => {
      const crossed = pullRef.current >= TRIGGER * 0.5;
      reset();
      if (crossed) runRef.current();
    };
    // ----- computers: pull down with the trackpad or mouse wheel while already at the very top -----
    // To keep a normal scroll-up-to-the-top from triggering it, the page must have been resting at the top for a moment,
    // and the pull has to be a deliberate burst (about three wheel notches, or a good trackpad drag).
    let restingSince = window.scrollY <= 0 ? Date.now() : 0;
    let burst = 0;
    let burstTimer: ReturnType<typeof setTimeout> | undefined;
    let cooldownUntil = 0;
    const onScroll = () => {
      restingSince = window.scrollY <= 0 ? restingSince || Date.now() : 0;
    };
    const wheel = (e: WheelEvent) => {
      if (phone() || e.deltaY >= 0 || window.scrollY > 0 || Date.now() < cooldownUntil) return;
      const target = e.target as HTMLElement | null;
      if (document.body.style.overflow === "hidden" || target?.closest?.("input, textarea, select, [data-no-pull]")) return;
      // something inside the page that can still scroll up should scroll first
      for (let el = target; el && el !== document.body; el = el.parentElement) {
        if (el.scrollTop > 0 && /(auto|scroll)/.test(getComputedStyle(el).overflowY)) return;
      }
      if (!restingSince || Date.now() - restingSince < 500) return;
      burst += -e.deltaY;
      pullRef.current = Math.min(MAX_PULL, burst * 0.25);
      setPull(pullRef.current);
      clearTimeout(burstTimer);
      if (burst >= 240) {
        burst = 0;
        cooldownUntil = Date.now() + 2000;
        reset();
        runRef.current();
      } else {
        burstTimer = setTimeout(() => {
          burst = 0;
          reset();
        }, 350);
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("wheel", wheel, { passive: true });

    document.addEventListener("touchstart", down, { passive: true });
    document.addEventListener("touchmove", move, { passive: true });
    document.addEventListener("touchend", up, { passive: true });
    document.addEventListener("touchcancel", reset, { passive: true });
    return () => {
      clearTimeout(burstTimer);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("wheel", wheel);
      document.removeEventListener("touchstart", down);
      document.removeEventListener("touchmove", move);
      document.removeEventListener("touchend", up);
      document.removeEventListener("touchcancel", reset);
    };
  }, []);

  const show = pull > 4 || busy;
  const ready = pull >= TRIGGER * 0.5;
  return (
    <div
      aria-hidden={!show}
      className="no-print pointer-events-none fixed inset-x-0 z-30 flex justify-center"
      style={{ top: "calc(env(safe-area-inset-top) + 3.4rem)", transform: `translateY(${busy ? 12 : Math.max(0, pull - 20)}px)`, opacity: show ? 1 : 0, transition: pull ? "none" : "opacity 150ms, transform 150ms" }}
    >
      <div className="flex items-center gap-2 rounded-full border border-ink-200 bg-ink-50 px-3 py-1.5 text-xs font-medium text-ink-700 shadow">
        <span aria-hidden className={`inline-block ${busy ? "animate-spin" : ""}`} style={busy ? undefined : { transform: `rotate(${ready ? 180 : 0}deg)`, transition: "transform 150ms" }}>
          {busy ? "⟳" : "↓"}
        </span>
        {busy ? t("chrome.refreshing") : ready ? t("chrome.releaseToRefresh") : t("chrome.pullToRefresh")}
      </div>
    </div>
  );
}
