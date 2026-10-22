"use client";

import { useCallback, useEffect, useRef } from "react";
import { ShareButton } from "@/components/share-button";

export interface LightboxPhoto {
  src: string;
  /** shown above the photo, e.g. "Receipt 1" or when it was taken */
  label: string;
}

const pill = "inline-flex min-h-[44px] items-center justify-center rounded-full bg-white/15 px-4 text-sm font-medium text-white hover:bg-white/25 active:bg-white/30";

/**
 * The one full-screen photo viewer for the whole app. A large ✕ Close button is always at the top (below the phone's notch), so
 * there is always a way out — and the phone's Back button, a swipe down, a tap beside the photo and the Esc key all close it
 * too. With several photos, swipe left/right or use Previous/Next. The page behind stays still while it is open.
 */
export function PhotoLightbox({ photos, index, onIndex, onClose }: { photos: LightboxPhoto[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const current = photos[index];
  const touch = useRef<{ x: number; y: number } | null>(null);
  const closedByBack = useRef(false);
  const count = photos.length;

  const step = useCallback((d: number) => onIndex((index + d + count) % count), [index, count, onIndex]);

  // The phone's Back button closes the viewer (instead of leaving the page): the viewer takes one history step while it is open.
  useEffect(() => {
    let pushed = false;
    const onPop = () => {
      closedByBack.current = true;
      onClose();
    };
    // a tick later, so a quick open-close-open (React redraws) never leaves a stray history step
    const timer = window.setTimeout(() => {
      window.history.pushState({ ...(window.history.state ?? {}), __photoViewer: true }, "");
      pushed = true;
      window.addEventListener("popstate", onPop);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("popstate", onPop);
      // closed with the button / swipe / Esc: give the history step back so Back still goes where it used to
      if (pushed && !closedByBack.current && (window.history.state as { __photoViewer?: boolean } | null)?.__photoViewer) window.history.back();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (count > 1 && e.key === "ArrowLeft") step(-1);
      if (count > 1 && e.key === "ArrowRight") step(1);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [count, step, onClose]);

  if (!current) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Photo viewer"
      className="fixed inset-0 z-[200] flex flex-col bg-black text-white"
      onClick={onClose}
      onTouchStart={(e) => {
        const t = e.touches[0];
        touch.current = { x: t.clientX, y: t.clientY };
      }}
      onTouchEnd={(e) => {
        const start = touch.current;
        touch.current = null;
        if (!start) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - start.x;
        const dy = t.clientY - start.y;
        if (dy > 90 && dy > Math.abs(dx) * 1.5) onClose(); // swipe down
        else if (count > 1 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1); // swipe sideways
      }}
    >
      <div className="flex items-center justify-between gap-3 px-3 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]" onClick={(e) => e.stopPropagation()}>
        <span className="min-w-0 truncate text-sm text-white/85">
          {current.label}
          {count > 1 && <span className="ml-2 text-white/60">{index + 1} / {count}</span>}
        </span>
        <button type="button" onClick={onClose} aria-label="Close photo" className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full bg-white px-5 text-base font-semibold text-black shadow-lg hover:bg-white/90 active:bg-white/80">
          <span aria-hidden>✕</span> Close
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={current.src} alt={current.label} onClick={(e) => e.stopPropagation()} className="absolute inset-0 m-auto max-h-full max-w-full select-none object-contain" draggable={false} />
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3" onClick={(e) => e.stopPropagation()}>
        {count > 1 && (
          <>
            <button type="button" onClick={() => step(-1)} className={pill} aria-label="Previous photo">
              ‹ Prev
            </button>
            <button type="button" onClick={() => step(1)} className={pill} aria-label="Next photo">
              Next ›
            </button>
          </>
        )}
        <a href={current.src} download className={pill}>
          ⬇ Download
        </a>
        <ShareButton src={current.src} filename="Maxey-photo.jpg" title={current.label || "Photo"} tone="light" />
      </div>
    </div>
  );
}
