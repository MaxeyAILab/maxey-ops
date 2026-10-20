"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/components/lang-provider";
import { haptic } from "@/components/feedback-provider";
import type { SearchGroup } from "@/lib/search";
import type { I18nKey } from "@/lib/i18n";

const OPEN_EVENT = "open-search";
export const openSearch = () => window.dispatchEvent(new Event(OPEN_EVENT));

/** The magnifier in the phone's top bar. */
export function SearchIconButton() {
  const t = useT();
  return (
    <button
      type="button"
      onClick={() => {
        haptic("tap");
        openSearch();
      }}
      aria-label={t("nav.search")}
      className="flex h-9 w-9 items-center justify-center rounded-lg border border-ink-200 text-base text-ink-600 hover:bg-ink-50"
    >
      <span aria-hidden>🔍</span>
    </button>
  );
}

/** The search box at the top of the side panel (looks like a field; opens the same search panel). */
export function SearchFieldButton() {
  const t = useT();
  return (
    <button
      type="button"
      onClick={openSearch}
      className="flex w-full items-center gap-2 rounded-lg border border-ink-200 bg-ink-100/60 px-3 py-2 text-left text-sm text-ink-400 hover:bg-ink-100"
    >
      <span aria-hidden>🔍</span>
      <span className="flex-1 truncate">{t("nav.search")}…</span>
      <kbd className="hidden rounded border border-ink-200 px-1 text-[10px] text-ink-400 md:inline">Ctrl K</kbd>
    </button>
  );
}

const GROUP_KEY: Record<SearchGroup["key"], I18nKey> = {
  projects: "search.projects",
  requisitions: "search.requisitions",
  purchaseOrders: "search.purchaseOrders",
  people: "search.people",
};
const GROUP_ICON: Record<SearchGroup["key"], string> = { projects: "🏗️", requisitions: "📝", purchaseOrders: "🛒", people: "👥" };

/** One search panel for the whole app: opened from the button in the top bar, the box in the side panel, or Ctrl/⌘ + K. */
export function SearchHost() {
  const t = useT();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(OPEN_EVENT, onOpen);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => setOpen(false), [path]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    setTimeout(() => inputRef.current?.focus(), 30);
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Search as they type, once they pause. Late answers to an older question are ignored.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setGroups([]);
      setState("idle");
      return;
    }
    setState("loading");
    let stale = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`);
        const json = (await res.json()) as { groups?: SearchGroup[] };
        if (!stale) {
          setGroups(res.ok ? (json.groups ?? []) : []);
          setState("done");
        }
      } catch {
        if (!stale) setState("done");
      }
    }, 250);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [q]);

  if (!open) return null;
  const firstHref = groups[0]?.items[0]?.href;
  return (
    <div className="no-print fixed inset-0 z-50 flex flex-col bg-ink-50 md:items-center md:bg-black/40 md:p-8" role="dialog" aria-modal="true" aria-label={t("nav.search")} onClick={() => setOpen(false)}>
      <div
        className="flex min-h-0 w-full flex-1 flex-col bg-ink-50 md:max-w-xl md:flex-none md:rounded-2xl md:border md:border-ink-200 md:shadow-2xl"
        style={{ paddingTop: "env(safe-area-inset-top)", maxHeight: "min(100dvh, 40rem)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-ink-200 p-3">
          <span aria-hidden>🔍</span>
          <input
            ref={inputRef}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && firstHref) window.location.assign(firstHref);
            }}
            placeholder={t("search.placeholder")}
            aria-label={t("nav.search")}
            enterKeyHint="search"
            autoComplete="off"
            maxLength={60}
            className="min-w-0 flex-1 bg-transparent text-base text-ink-900 outline-none placeholder:text-ink-400"
          />
          <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-2 py-1 text-sm font-medium text-ink-600 hover:bg-ink-100">
            {t("chrome.close")}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {state === "idle" && <p className="p-4 text-center text-sm text-ink-500">{t("search.hint")}</p>}
          {state === "loading" && groups.length === 0 && <p className="p-4 text-center text-sm text-ink-500">{t("search.searching")}</p>}
          {state === "done" && groups.length === 0 && <p className="p-4 text-center text-sm text-ink-500">{t("search.none")}</p>}
          {groups.map((g) => (
            <section key={g.key} className="mb-2">
              <h3 className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-ink-400">{t(GROUP_KEY[g.key])}</h3>
              <ul>
                {g.items.map((i) => (
                  <li key={i.id}>
                    <Link href={i.href} onClick={() => setOpen(false)} className="flex items-start gap-3 rounded-lg px-3 py-2.5 hover:bg-ink-100">
                      <span aria-hidden className="mt-0.5 text-lg">
                        {GROUP_ICON[g.key]}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-ink-900">{i.title}</span>
                        <span className="block truncate text-xs text-ink-500">{i.subtitle}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
