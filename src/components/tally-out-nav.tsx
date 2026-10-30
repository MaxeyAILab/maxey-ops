"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Sidebar link to the tally-out forms, for drivers and office staff who do not have the Inventory tab. */
export function TallyOutNav() {
  const path = usePathname() ?? "";
  const active = path.startsWith("/inventory/tally-outs");
  return (
    <div className="mt-3 border-t border-ink-100 pt-3">
      <Link
        href="/inventory/tally-outs"
        aria-current={active ? "page" : undefined}
        className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${active ? "bg-[#8a1a28] font-semibold text-white shadow-sm" : "text-ink-600 hover:bg-brand-50 hover:text-brand-700"}`}
      >
        <span aria-hidden className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-base ${active ? "bg-white/20" : "bg-amber-100"}`}>
          📋
        </span>
        <span className="flex-1">Tally-out forms</span>
      </Link>
    </div>
  );
}
