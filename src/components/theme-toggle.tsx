"use client";

import { useEffect, useState } from "react";

/** Inline, unminified so it can be pasted into a <script> tag verbatim —
 * runs before paint (see root layout) to set the class before hydration,
 * so there's no light-then-dark flash on load. */
export const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem("theme");
    var dark = stored ? stored === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.classList.toggle("dark", dark);
  } catch (e) {}
})();
`;

/** Sidebar/header control — toggles the persisted theme class set by
 * THEME_INIT_SCRIPT. Reads current state from the DOM on mount rather than
 * localStorage directly, since the init script may have fallen back to the
 * OS preference when nothing was stored yet. */
export function ThemeToggle({ className }: { className?: string }) {
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  }

  // Avoid rendering a possibly-wrong icon before mount reads the real state.
  if (dark === null) {
    return <span className={className} style={{ width: "1.5rem", height: "1.5rem" }} aria-hidden />;
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      className={
        className ??
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-base text-ink-500 hover:bg-ink-100 hover:text-ink-700"
      }
    >
      {dark ? "☀️" : "🌙"}
    </button>
  );
}
