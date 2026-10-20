"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/lang-provider";
import { mapsLink, osmEmbedUrl, parseGps } from "@/lib/geo";

/**
 * Where a clock-in or a delivery check was recorded, as a pin on a map. The map opens in a panel and is only loaded (from
 * OpenStreetMap, which is free) when the person taps "View map", so nothing is sent anywhere until they ask to see it.
 */
export function LocationPin({ gps, label }: { gps: string | null | undefined; label?: string }) {
  const t = useT();
  const [show, setShow] = useState(false);
  const point = parseGps(gps);

  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setShow(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [show]);

  if (!point) return <span className="text-xs text-ink-400">{t("map.noLocation")}</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <button type="button" onClick={() => setShow(true)} className="font-medium text-brand-600 hover:underline">
        📍 {label ?? t("map.viewMap")}
      </button>
      <a href={mapsLink(point)} target="_blank" rel="noopener noreferrer" className="text-ink-500 hover:underline">
        {t("map.openInMaps")} ↗
      </a>
      {show && (
        <span className="no-print fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={t("map.location")} onClick={() => setShow(false)}>
          <span className="block w-full max-w-lg overflow-hidden rounded-t-2xl bg-ink-50 shadow-xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <span className="flex items-center justify-between gap-3 border-b border-ink-200 px-4 py-3 text-sm">
              <span className="min-w-0 truncate font-semibold text-ink-900">
                📍 {label ?? t("map.location")}
                <span className="ml-2 font-normal text-ink-400">
                  {point.lat.toFixed(5)}, {point.lng.toFixed(5)}
                </span>
              </span>
              <button type="button" onClick={() => setShow(false)} aria-label={t("chrome.close")} className="shrink-0 rounded-lg px-2 py-1 text-ink-500 hover:bg-ink-100">
                ✕
              </button>
            </span>
            <iframe
              title={t("map.location")}
              src={osmEmbedUrl(point)}
              referrerPolicy="strict-origin-when-cross-origin"
              sandbox="allow-scripts allow-same-origin"
              className="block h-72 w-full border-0"
            />
            <span className="block px-4 py-3 text-right" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
              <a href={mapsLink(point)} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-brand-600 hover:underline">
                {t("map.openInMaps")} ↗
              </a>
            </span>
          </span>
        </span>
      )}
    </span>
  );
}
