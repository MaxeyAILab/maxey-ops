"use client";

import { useEffect, useState } from "react";

export interface PhotoViewerItem {
  src: string;
  label: string; // e.g. "Sep 17, 2026, 1:26 PM" — when this photo was posted
}

/**
 * Thumbnails that open a full-size, downloadable lightbox on click — used
 * wherever a form attaches site photos (progress entries, daily reports).
 * Each thumbnail is date-stamped so it's clear when it was taken/posted,
 * since these photos are the record, not just a UI nicety.
 */
export function PhotoThumbnails({ photos }: { photos: PhotoViewerItem[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  useEffect(() => {
    if (openIndex === null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenIndex(null);
      if (e.key === "ArrowLeft") setOpenIndex((i) => (i === null ? i : (i - 1 + photos.length) % photos.length));
      if (e.key === "ArrowRight") setOpenIndex((i) => (i === null ? i : (i + 1) % photos.length));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openIndex, photos.length]);

  if (photos.length === 0) return null;
  const current = openIndex !== null ? photos[openIndex] : null;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {photos.map((p, i) => (
          <button
            key={p.src + i}
            type="button"
            onClick={() => setOpenIndex(i)}
            className="group relative h-20 w-20 overflow-hidden rounded-lg border border-ink-100"
            aria-label={`View photo from ${p.label}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={p.src}
              alt=""
              className="h-full w-full object-cover transition group-hover:opacity-80"
            />
            <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1 py-0.5 text-[8px] leading-tight text-white">
              {p.label}
            </span>
          </button>
        ))}
      </div>

      {current && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setOpenIndex(null)}
        >
          <div className="max-h-full max-w-3xl" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={current.src} alt="" className="max-h-[75vh] w-auto rounded-lg object-contain" />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm text-white/90">Posted {current.label}</span>
              <div className="flex items-center gap-2">
                {photos.length > 1 && (
                  <>
                    <button
                      type="button"
                      onClick={() => setOpenIndex((i) => (i === null ? i : (i - 1 + photos.length) % photos.length))}
                      className="rounded-lg bg-white/10 px-3 py-1.5 text-sm font-medium text-white hover:bg-white/20"
                    >
                      ‹ Prev
                    </button>
                    <span className="text-xs text-white/60">
                      {openIndex! + 1} / {photos.length}
                    </span>
                    <button
                      type="button"
                      onClick={() => setOpenIndex((i) => (i === null ? i : (i + 1) % photos.length))}
                      className="rounded-lg bg-white/10 px-3 py-1.5 text-sm font-medium text-white hover:bg-white/20"
                    >
                      Next ›
                    </button>
                  </>
                )}
                <a
                  href={current.src}
                  download
                  onClick={(e) => e.stopPropagation()}
                  className="rounded-lg bg-white/10 px-3 py-1.5 text-sm font-medium text-white hover:bg-white/20"
                >
                  ⬇ Download
                </a>
                <button
                  type="button"
                  onClick={() => setOpenIndex(null)}
                  className="rounded-lg bg-white/10 px-3 py-1.5 text-sm font-medium text-white hover:bg-white/20"
                >
                  ✕ Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
