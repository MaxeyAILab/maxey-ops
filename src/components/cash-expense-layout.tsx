"use client";

import { useEffect, useState } from "react";

/**
 * "+ New request" button that opens the Quick Record form in a pop-up instead of a whole column of the page.
 * It also opens by itself when the page is reached at #quick-record (the mobile "+" button links there).
 */
export function NewRequestDialog({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const check = () => {
      if (window.location.hash === "#quick-record") setOpen(true);
    };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function close() {
    setOpen(false);
    if (window.location.hash === "#quick-record") history.replaceState(null, "", window.location.pathname + window.location.search);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fx-grad inline-flex min-h-[44px] items-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-white hover:brightness-110"
      >
        <span aria-hidden className="text-lg leading-none">+</span> New request
      </button>
      {open && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={close}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="New petty cash request"
            onClick={(e) => e.stopPropagation()}
            className="fx-card max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border border-ink-200 bg-ink-50 sm:max-w-lg sm:rounded-2xl"
          >
            <div className="sticky top-0 z-[1] flex items-center justify-between border-b border-ink-100 bg-ink-50 px-5 py-3">
              <h2 className="text-base font-bold text-ink-900">New petty cash request</h2>
              <button type="button" onClick={close} aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-full text-xl text-ink-500 hover:bg-ink-100">
                ×
              </button>
            </div>
            <div className="p-5">{children}</div>
          </div>
        </div>
      )}
    </>
  );
}

export interface QueueTab {
  key: string;
  label: string;
  count: number;
  content: React.ReactNode;
}

/**
 * The Petty Cash Report work queue: one list at a time, picked with pill tabs. Every list is rendered, so a link to
 * #liquidate-… or #missing-receipts switches to the tab holding that element and scrolls to it.
 */
export function QueueTabs({ tabs, initial }: { tabs: QueueTab[]; initial: string }) {
  const [active, setActive] = useState(initial);

  useEffect(() => {
    const go = () => {
      const id = window.location.hash.slice(1);
      if (!id) return;
      const el = document.getElementById(id);
      const panel = el?.closest<HTMLElement>("[data-queue-tab]");
      if (panel?.dataset.queueTab) {
        setActive(panel.dataset.queueTab);
        setTimeout(() => el?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
      }
    };
    go();
    window.addEventListener("hashchange", go);
    return () => window.removeEventListener("hashchange", go);
  }, []);

  return (
    <div>
      <div role="tablist" className="flex gap-1.5 overflow-x-auto border-b border-ink-100 px-3 py-3 sm:px-4">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active === t.key}
            onClick={() => setActive(t.key)}
            className={`fx-pill shrink-0 whitespace-nowrap ${active === t.key ? "fx-pill-on" : ""}`}
          >
            {t.label}
            <span className={`ml-1.5 rounded-full px-1.5 font-mono text-[11px] font-bold ${t.count ? "bg-amber-400 text-ink-950 dark:text-[#1d1230]" : "bg-ink-100 text-ink-500"}`}>{t.count}</span>
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t.key} data-queue-tab={t.key} role="tabpanel" hidden={active !== t.key}>
          {t.count ? t.content : <p className="px-4 py-8 text-center text-sm text-ink-500">Nothing here — all clear ✓</p>}
        </div>
      ))}
    </div>
  );
}

/** Opens the print dialog once when the page was opened with ?print=1 (the per-project "Print" links). */
export function AutoPrint({ when }: { when: boolean }) {
  useEffect(() => {
    if (!when) return;
    const t = setTimeout(() => window.print(), 700);
    return () => clearTimeout(t);
  }, [when]);
  return null;
}
