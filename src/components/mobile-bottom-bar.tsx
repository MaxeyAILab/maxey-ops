"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useT } from "@/components/lang-provider";
import { haptic } from "@/components/feedback-provider";
import { openSearch } from "@/components/global-search";
import { playChime } from "@/lib/chime";
import { badgeText, categoriesForTab, tabUnread, type UnreadByCategory } from "@/lib/tab-activity";
import type { QuickDef } from "@/lib/quick-actions";
import type { I18nKey } from "@/lib/i18n";

export interface BarTab {
  /** the tab (e.g. "/requisitions"; Cash Expense is "/cash-expense") */
  href: string;
  /** where tapping it goes */
  target: string;
  labelKey: I18nKey;
  icon: string;
}

export type QuickAction = QuickDef;

const ACTIVE = "text-[#8a1a28] dark:text-red-300";
const FAB_SIZE = 56;
const FAB_MARGIN = 8;
const FAB_KEY = "maxey_fab";
/** Pages that live under another tab: a quotation is opened from Leads / CRM. */
const PARENT_TAB: Record<string, string> = { "/quotations": "/leads" };

/** True while a text box has the keyboard, when the bars would only be in the way. */
function useTyping() {
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const isField = (el: EventTarget | null) => el instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && !(el instanceof HTMLInputElement && ["checkbox", "radio", "button", "submit", "file"].includes(el.type));
    const on = (e: FocusEvent) => setTyping(isField(e.target));
    const off = () => setTyping(false);
    document.addEventListener("focusin", on);
    document.addEventListener("focusout", off);
    return () => {
      document.removeEventListener("focusin", on);
      document.removeEventListener("focusout", off);
    };
  }, []);
  return typing;
}

/** The tabs a person uses most, along the bottom of the phone screen, within thumb's reach. */
export function MobileBottomBar({
  tabs,
  unread,
  actions,
  progressProjects,
}: {
  tabs: BarTab[];
  /** how many new things there are in each kind of notification right now */
  unread: UnreadByCategory;
  actions: QuickAction[];
  progressProjects: { id: string; name: string }[];
}) {
  const t = useT();
  const router = useRouter();
  const path = usePathname() ?? "";
  const typing = useTyping();
  const first = "/" + (path.split("/")[1] ?? "");
  const current = PARENT_TAB[first] ?? first;

  // The numbers on the tabs. They follow what the server last told this page, and are topped up by asking again every
  // minute and whenever the app comes back to the front.
  const [counts, setCounts] = useState<UnreadByCategory>(unread);
  const unreadKey = JSON.stringify(unread);
  useEffect(() => setCounts(unread), [unreadKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const countsRef = useRef(counts);
  countsRef.current = counts;

  // A soft chime when something new arrives while the app is open (never for numbers going down, or on first load).
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const prevTotal = useRef(total);
  useEffect(() => {
    if (total > prevTotal.current) {
      playChime();
      haptic("ok");
    }
    prevTotal.current = total;
  }, [total]);

  useEffect(() => {
    let stop = false;
    async function check() {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/notifications?summary=1", { cache: "no-store" });
        if (!res.ok || stop) return;
        const next = ((await res.json()) as { byCategory?: UnreadByCategory }).byCategory ?? {};
        if (JSON.stringify(next) !== JSON.stringify(countsRef.current)) {
          setCounts(next);
          router.refresh(); // also updates the bell and the menu button
        }
      } catch {
        // offline — try again next time
      }
    }
    const timer = setInterval(check, 60_000);
    document.addEventListener("visibilitychange", check);
    return () => {
      stop = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [router]);

  // Being in a section is how you see what happened in it: its new-activity number clears (the items stay in the bell's list).
  const here = tabs.find((tab) => tab.href === current);
  const hereCount = here ? tabUnread(here.href, counts) : 0;
  useEffect(() => {
    if (!here || hereCount === 0) return;
    const cats = categoriesForTab(here.href);
    setCounts((c) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, cats.includes(k) ? 0 : v])));
    fetch("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ categories: cats }) })
      .then(() => router.refresh())
      .catch(() => undefined);
  }, [here, hereCount, router]);

  return (
    <>
      <nav
        aria-label={t("chrome.menu")}
        className={`no-print fixed inset-x-0 bottom-0 z-[15] border-t border-ink-200 bg-ink-50 md:hidden ${typing ? "hidden" : ""}`}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <ul className="grid" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
          {tabs.map((tab) => {
            const on = tab.href === current;
            const badge = tabUnread(tab.href, counts);
            return (
              <li key={tab.href}>
                <Link
                  href={tab.target}
                  onClick={() => haptic("tap")}
                  aria-current={on ? "page" : undefined}
                  aria-label={badge > 0 ? `${t(tab.labelKey)}, ${badge}` : undefined}
                  className={`relative flex min-h-[56px] flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[11px] font-medium leading-tight ${on ? ACTIVE : "text-ink-500"}`}
                >
                  <span aria-hidden className={`absolute inset-x-5 top-0 h-0.5 rounded-b ${on ? "bg-[#8a1a28] dark:bg-red-300" : "bg-transparent"}`} />
                  <span aria-hidden className="relative text-xl leading-none">
                    {tab.icon}
                    {badge > 0 && <span className="absolute -right-3 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">{badgeText(badge)}</span>}
                  </span>
                  <span className="w-full truncate text-center">{t(tab.labelKey)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      {actions.length > 0 && <QuickAdd actions={actions} progressProjects={progressProjects} hide={typing} />}
    </>
  );
}

/** The floating "+": the jobs people do most, one tap from anywhere. */
function QuickAdd({ actions, progressProjects, hide }: { actions: QuickAction[]; progressProjects: { id: string; name: string }[]; hide: boolean }) {
  const t = useT();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);

  // ----- the button can be dragged anywhere on screen, and stays where it was put (on this device) -----
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ id: number; sx: number; sy: number; bx: number; by: number; moved: boolean } | null>(null);
  const justDragged = useRef(false);

  const clamp = useCallback((x: number, y: number) => ({
    x: Math.min(Math.max(FAB_MARGIN, x), Math.max(FAB_MARGIN, window.innerWidth - FAB_SIZE - FAB_MARGIN)),
    y: Math.min(Math.max(FAB_MARGIN, y), Math.max(FAB_MARGIN, window.innerHeight - FAB_SIZE - FAB_MARGIN)),
  }), []);
  const fromRatio = useCallback((rx: number, ry: number) => clamp(rx * (window.innerWidth - FAB_SIZE), ry * (window.innerHeight - FAB_SIZE)), [clamp]);
  const save = (p: { x: number; y: number }) => {
    try {
      localStorage.setItem(FAB_KEY, JSON.stringify({ rx: p.x / Math.max(1, window.innerWidth - FAB_SIZE), ry: p.y / Math.max(1, window.innerHeight - FAB_SIZE) }));
    } catch {
      // storage blocked — it just goes back to the corner next time
    }
  };

  useEffect(() => {
    const load = () => {
      try {
        const raw = localStorage.getItem(FAB_KEY);
        if (!raw) return setPos(null);
        const { rx, ry } = JSON.parse(raw) as { rx: number; ry: number };
        if (typeof rx === "number" && typeof ry === "number") setPos(fromRatio(rx, ry));
      } catch {
        setPos(null);
      }
    };
    load();
    window.addEventListener("resize", load);
    return () => window.removeEventListener("resize", load);
  }, [fromRatio]);

  const latest = useRef<{ x: number; y: number } | null>(null);
  const move = (x: number, y: number) => {
    const p = clamp(x, y);
    latest.current = p;
    setPos(p);
  };
  const resetPosition = () => {
    try {
      localStorage.removeItem(FAB_KEY);
    } catch {
      // nothing to forget
    }
    setPos(null);
  };

  useEffect(() => {
    setOpen(false);
    setPicking(false);
  }, [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const row = "flex w-full items-center gap-3 rounded-xl border border-ink-200 bg-ink-50 px-4 py-3 text-left text-sm font-medium text-ink-900 active:bg-ink-100";
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onPointerDown={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, bx: r.left, by: r.top, moved: false };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || d.id !== e.pointerId) return;
          const dx = e.clientX - d.sx;
          const dy = e.clientY - d.sy;
          if (!d.moved && Math.hypot(dx, dy) < 6) return; // a tap, not a drag
          d.moved = true;
          move(d.bx + dx, d.by + dy);
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
          if (d?.moved) {
            justDragged.current = true;
            setTimeout(() => (justDragged.current = false), 0);
            if (latest.current) save(latest.current);
          }
        }}
        onPointerCancel={() => (drag.current = null)}
        onKeyDown={(e) => {
          // arrow keys nudge it for people who can't drag
          const step = e.shiftKey ? 64 : 16;
          const delta: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
          const d = delta[e.key];
          if (!d || !e.altKey) return;
          e.preventDefault();
          const r = e.currentTarget.getBoundingClientRect();
          const next = clamp(r.left + d[0], r.top + d[1]);
          setPos(next);
          save(next);
        }}
        onClick={() => {
          if (justDragged.current) return;
          haptic("tap");
          setPicking(false);
          setOpen(true);
        }}
        aria-label={t("chrome.quickAdd")}
        aria-haspopup="dialog"
        title={t("quick.dragHint")}
        className={`no-print fixed z-[15] flex h-14 w-14 cursor-grab touch-none select-none items-center justify-center rounded-full bg-[#8a1a28] text-3xl font-light leading-none text-white shadow-lg active:cursor-grabbing active:scale-95 ${hide ? "max-md:hidden" : ""} ${pos ? "" : "bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] right-4 md:bottom-6 md:right-6"}`}
        style={pos ? { left: pos.x, top: pos.y } : undefined}
      >
        <span aria-hidden>+</span>
      </button>

      {open && (
        <div className="no-print fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label={t("quick.title")}>
          <div aria-hidden className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[80dvh] overflow-y-auto rounded-t-2xl border-t border-ink-200 bg-ink-50 p-4 shadow-xl md:inset-x-auto md:bottom-auto md:left-1/2 md:top-1/2 md:w-96 md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl md:border" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1rem)" }}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink-900">{picking ? t("quick.pickProject") : t("quick.title")}</h2>
              {picking ? (
                <button type="button" onClick={() => setPicking(false)} className="text-sm font-medium text-brand-600">
                  {t("quick.back")}
                </button>
              ) : (
                <button type="button" onClick={() => setOpen(false)} aria-label={t("chrome.close")} className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-500 hover:bg-ink-100">
                  <span aria-hidden>✕</span>
                </button>
              )}
            </div>
            {picking ? (
              <ul className="space-y-2">
                {progressProjects.map((p) => (
                  <li key={p.id}>
                    <Link href={`/projects/${p.id}#progress`} className={row}>
                      <span aria-hidden>🏗️</span>
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    </Link>
                  </li>
                ))}
                {progressProjects.length === 0 && <li className="py-3 text-center text-sm text-ink-500">{t("quick.noProjects")}</li>}
              </ul>
            ) : (
              <ul className="space-y-2">
                {actions.map((a) => (
                  <li key={a.key}>
                    {a.kind === "link" && a.href ? (
                      <Link href={a.href} className={row}>
                        <span aria-hidden className="text-xl">
                          {a.icon}
                        </span>
                        {t(a.labelKey)}
                      </Link>
                    ) : a.kind === "search" ? (
                      <button
                        type="button"
                        onClick={() => {
                          setOpen(false);
                          openSearch();
                        }}
                        className={row}
                      >
                        <span aria-hidden className="text-xl">
                          {a.icon}
                        </span>
                        {t(a.labelKey)}
                      </button>
                    ) : (
                      <button type="button" onClick={() => setPicking(true)} className={row}>
                        <span aria-hidden className="text-xl">
                          {a.icon}
                        </span>
                        <span className="flex-1">{t(a.labelKey)}</span>
                        <span aria-hidden className="text-ink-400">
                          ›
                        </span>
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {pos && !picking && (
              <button type="button" onClick={resetPosition} className="mt-3 w-full text-center text-xs font-medium text-ink-500 hover:underline">
                {t("quick.resetPosition")}
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
