"use client";

import { useEffect, useState } from "react";
import { PhotoLightbox, type LightboxPhoto } from "@/components/photo-lightbox";
import { isViewableImageHref } from "@/lib/image-link";

/** A link to a picture stored by the app — not an outside website or a PDF — and not one meant to download. */
function imageHref(a: HTMLAnchorElement): string | null {
  if (a.hasAttribute("download")) return null;
  const href = a.getAttribute("href");
  return isViewableImageHref(href) ? href : null;
}

function labelOf(a: HTMLAnchorElement): string {
  return (a.textContent ?? "").replace(/\s+/g, " ").trim() || a.querySelector("img")?.getAttribute("alt") || "Photo";
}

/**
 * Makes every link to a picture in the app open in the photo viewer (with its Close button) instead of leaving the page for a
 * bare picture with no way back — which is what a phone app does with a plain link. Other links (PDFs, outside sites) are left
 * alone. Several picture links side by side (Receipt 1, Receipt 2…) become one set you can page through. Mounted once, in the
 * root layout.
 */
export function ImageLinkViewer() {
  const [view, setView] = useState<{ photos: LightboxPhoto[]; index: number } | null>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || !imageHref(a)) return;
      e.preventDefault();
      // the picture links sitting together with this one (same parent) form the set
      const group = Array.from(a.parentElement?.querySelectorAll<HTMLAnchorElement>("a[href]") ?? []).filter((x) => imageHref(x));
      const links = group.includes(a) ? group : [a];
      setView({ photos: links.map((x) => ({ src: x.getAttribute("href")!, label: labelOf(x) })), index: Math.max(0, links.indexOf(a)) });
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  if (!view) return null;
  return <PhotoLightbox photos={view.photos} index={view.index} onIndex={(i) => setView({ ...view, index: i })} onClose={() => setView(null)} />;
}
