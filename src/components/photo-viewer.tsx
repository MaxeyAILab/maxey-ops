"use client";

import { useState } from "react";
import { PhotoLightbox } from "@/components/photo-lightbox";

export interface PhotoViewerItem {
  src: string;
  label: string; // e.g. "Sep 17, 2026, 1:26 PM" — when this photo was posted
}

/**
 * Thumbnails that open the full-screen photo viewer on click — used wherever a form attaches site photos (progress entries,
 * daily reports, return/transfer requests). Each thumbnail is date-stamped so it's clear when it was taken/posted, since these
 * photos are the record, not just a UI nicety. The viewer itself (PhotoLightbox) always has a Close button.
 */
export function PhotoThumbnails({ photos }: { photos: PhotoViewerItem[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  if (photos.length === 0) return null;

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
            <img src={p.src} alt="" className="h-full w-full object-cover transition group-hover:opacity-80" />
            <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1 py-0.5 text-[8px] leading-tight text-white">{p.label}</span>
          </button>
        ))}
      </div>

      {openIndex !== null && <PhotoLightbox photos={photos.map((p) => ({ src: p.src, label: p.label }))} index={openIndex} onIndex={setOpenIndex} onClose={() => setOpenIndex(null)} />}
    </>
  );
}
