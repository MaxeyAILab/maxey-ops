"use client";

import { createContext, useContext, useEffect, useState } from "react";

const STORAGE_KEY = "maxey:dashboard-hide-figures";

// null = preference not read yet; figures stay masked until it is, so they never flash on load.
const HiddenContext = createContext<{ hidden: boolean | null; toggle: () => void }>({
  hidden: false,
  toggle: () => {},
});

export function FigureVisibilityProvider({ children }: { children: React.ReactNode }) {
  const [hidden, setHidden] = useState<boolean | null>(null);

  useEffect(() => {
    let stored = false;
    try {
      stored = localStorage.getItem(STORAGE_KEY) === "1";
    } catch {}
    setHidden(stored);
  }, []);

  function toggle() {
    const next = !hidden;
    setHidden(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {}
  }

  return <HiddenContext.Provider value={{ hidden, toggle }}>{children}</HiddenContext.Provider>;
}

export function FigureToggle() {
  const { hidden, toggle } = useContext(HiddenContext);
  const isHidden = hidden !== false;
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={isHidden}
      className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-sm font-medium text-ink-700 hover:bg-ink-50 dark:border-ink-700 dark:bg-transparent dark:text-ink-200"
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {isHidden ? (
          <>
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
            <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
            <path d="M1 1l22 22" />
          </>
        ) : (
          <>
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </>
        )}
      </svg>
      {isHidden ? "Show figures" : "Hide figures"}
    </button>
  );
}

export function Fig({ children }: { children: React.ReactNode }) {
  const { hidden } = useContext(HiddenContext);
  if (hidden !== false) return <span aria-label="hidden">₱•••••</span>;
  return <>{children}</>;
}

export function FigPlain({ children }: { children: React.ReactNode }) {
  const { hidden } = useContext(HiddenContext);
  if (hidden !== false) return <span aria-label="hidden">•••</span>;
  return <>{children}</>;
}

export function FigChart({ children }: { children: React.ReactNode }) {
  const { hidden } = useContext(HiddenContext);
  if (hidden !== false) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-ink-400">
        Chart hidden — click “Show figures” to reveal.
      </div>
    );
  }
  return <>{children}</>;
}
