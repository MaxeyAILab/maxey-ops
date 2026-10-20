"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useT } from "@/components/lang-provider";
import { haptic } from "@/components/feedback-provider";
import { openSearch } from "@/components/global-search";
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
      {actions.length > 0 && !typing && <QuickAdd actions={actions} progressProjects={progressProjects} />}
    </>
  );
}

/** The floating "+": the jobs people do most, one tap from anywhere. */
function QuickAdd({ actions, progressProjects }: { actions: QuickAction[]; progressProjects: { id: string; name: string }[] }) {
  const t = useT();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);

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
        type="button"
        onClick={() => {
          haptic("tap");
          setPicking(false);
          setOpen(true);
        }}
        aria-label={t("chrome.quickAdd")}
        aria-haspopup="dialog"
        className="no-print fixed right-4 z-[15] flex h-14 w-14 items-center justify-center rounded-full bg-[#8a1a28] text-3xl font-light leading-none text-white shadow-lg active:scale-95 md:hidden"
        style={{ bottom: "calc(env(safe-area-inset-bottom) + 4.75rem)" }}
      >
        <span aria-hidden>+</span>
      </button>

      {open && (
        <div className="no-print fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label={t("quick.title")}>
          <div aria-hidden className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[80dvh] overflow-y-auto rounded-t-2xl border-t border-ink-200 bg-ink-50 p-4 shadow-xl" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1rem)" }}>
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
          </div>
        </div>
      )}
    </>
  );
}
