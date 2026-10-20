"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

const EDGE = 28; // px from the left edge where an open-swipe may start
const SWIPE = 60; // px of horizontal travel that counts as a swipe

/**
 * Phone version of the left command panel: the same panel slides in over the page and is tucked away again.
 * Opens with the ☰ button, a swipe in from the left edge, or a swipe down on the top bar (marked data-menu-swipe); closes with ✕, a tap outside, a swipe back to the left,
 * the Escape key, or by choosing a tab.
 */
export function MobileDrawer({ children, alert }: { children: React.ReactNode; alert?: boolean }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  const closeRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const openRef = useRef(open);
  openRef.current = open;

  const close = useCallback(() => setOpen(false), []);

  // Going to another page puts the panel away.
  useEffect(() => {
    setOpen(false);
  }, [path]);

  // Escape closes; the page behind doesn't scroll while the panel is out; focus goes in and returns to the button.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const opener = openerRef.current;
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      opener?.focus();
    };
  }, [open]);

  // Swipe in from the left edge (or down on the top bar) to open, swipe left to close.
  useEffect(() => {
    let startX = 0;
    let startY = 0;
    let tracking = false;
    let fromBar = false;
    const down = (e: TouchEvent) => {
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      fromBar = !!(e.target as HTMLElement | null)?.closest?.("[data-menu-swipe]");
      tracking = openRef.current || startX <= EDGE || fromBar;
    };
    const move = (e: TouchEvent) => {
      if (!tracking) return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (Math.abs(dy) > Math.abs(dx)) {
        // mostly vertical: scrolling the page — except a pull down on the top bar, which opens the menu
        if (!openRef.current && fromBar && dy > SWIPE) {
          tracking = false;
          setOpen(true);
        }
        return;
      }
      if (!openRef.current && dx > SWIPE) {
        tracking = false;
        setOpen(true);
      } else if (openRef.current && dx < -SWIPE) {
        tracking = false;
        setOpen(false);
      }
    };
    const up = () => {
      tracking = false;
    };
    document.addEventListener("touchstart", down, { passive: true });
    document.addEventListener("touchmove", move, { passive: true });
    document.addEventListener("touchend", up, { passive: true });
    return () => {
      document.removeEventListener("touchstart", down);
      document.removeEventListener("touchmove", move);
      document.removeEventListener("touchend", up);
    };
  }, []);

  return (
    <>
      <button
        ref={openerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        aria-expanded={open}
        aria-controls="mobile-panel"
        className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-ink-200 text-lg text-ink-700 hover:bg-ink-100"
      >
        <span aria-hidden>☰</span>
        {alert && <span aria-hidden className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-red-600" />}
      </button>

      <div
        aria-hidden
        onClick={close}
        className={`no-print fixed inset-0 z-40 bg-black/40 transition-opacity duration-200 motion-reduce:transition-none ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
      />
      <aside
        id="mobile-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        // choosing a tab (even the one you're already on) puts the panel away
        onClick={(e) => (e.target as HTMLElement).closest("a") && setOpen(false)}
        className={`no-print fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r border-ink-200 bg-ink-50 shadow-xl transition-[transform,visibility] duration-200 motion-reduce:transition-none ${open ? "visible translate-x-0" : "invisible -translate-x-full"}`}
        style={{ height: "100dvh" }}
      >
        <button
          ref={closeRef}
          type="button"
          onClick={close}
          aria-label="Close menu"
          className="absolute right-2 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-lg text-ink-500 hover:bg-ink-100"
        >
          <span aria-hidden>✕</span>
        </button>
        {children}
      </aside>
    </>
  );
}
