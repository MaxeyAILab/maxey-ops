"use client";

import { useEffect, useRef } from "react";

/**
 * A card that starts folded: the header (title, count) is always visible and a click opens the body. It also opens by itself when
 * the page is reached through its #id link (for example the Requisitions entry in the project's section menu).
 */
export function CollapsibleCard({ id, title, subtitle, children }: { id: string; title: React.ReactNode; subtitle?: React.ReactNode; children: React.ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const openIfLinked = () => {
      if (window.location.hash === `#${id}` && ref.current) ref.current.open = true;
    };
    openIfLinked();
    window.addEventListener("hashchange", openIfLinked);
    return () => window.removeEventListener("hashchange", openIfLinked);
  }, [id]);

  return (
    <details ref={ref} id={id} className="group scroll-mt-14 rounded-sm border border-ink-200 bg-ink-50">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3 px-4 py-3 sm:px-5 [&::-webkit-details-marker]:hidden">
        <div>
          <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-ink-500">{subtitle}</p>}
        </div>
        <span className="mt-0.5 shrink-0 text-xs font-medium text-brand-600 group-open:hidden">Show ▾</span>
        <span className="mt-0.5 hidden shrink-0 text-xs font-medium text-brand-600 group-open:inline">Hide ▴</span>
      </summary>
      <div className="space-y-2 border-t border-ink-100 px-4 py-4 sm:px-5">{children}</div>
    </details>
  );
}
