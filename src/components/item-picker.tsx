"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MATERIAL_CATEGORIES, MATERIAL_CATEGORY_LABEL, isMaterialCategory } from "@/lib/material-category";
import { MAX_SHOWN, filterItems, recentItems, type PickItem } from "@/lib/item-search";

const SHORT: Record<string, string> = { CIVIL_ARCHITECTURAL: "Civil", PLUMBING: "Plumbing", ELECTRICAL: "Electrical", OTHERS: "Others" };

/**
 * Choose a material by typing part of its name instead of scrolling a long list. Category buttons narrow it down, the items you
 * used most recently are offered first, and each result shows its category and how many there are. Works on a phone (the list
 * slides up from the bottom) and with the keyboard (↑ ↓ Enter Esc). The choice is sent with the form as `name` (default "itemId").
 */
export function ItemPicker({
  items,
  recentIds = [],
  name = "itemId",
  id = "item-picker",
  qtyNote = "in warehouse",
  placeholder = "Search an item…",
  onChange,
}: {
  items: PickItem[];
  recentIds?: string[];
  name?: string;
  id?: string;
  /** what the quantity means: "in warehouse", "on site" */
  qtyNote?: string;
  placeholder?: string;
  onChange?: (item: PickItem | null) => void;
}) {
  const [selected, setSelected] = useState<PickItem | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const searching = query.trim() !== "" || category !== null;
  const recents = useMemo(() => (searching ? [] : recentItems(recentIds, items)), [searching, recentIds, items]);
  const result = useMemo(() => filterItems(items, { query, category }), [items, query, category]);
  const shownMatches = useMemo(() => {
    if (searching) return result.matches;
    const recentSet = new Set(recents.map((r) => r.id));
    return result.matches.filter((i) => !recentSet.has(i.id)); // recents are already listed above
  }, [searching, result.matches, recents]);
  const rows = useMemo(() => [...recents, ...shownMatches], [recents, shownMatches]);

  useEffect(() => setActive(0), [query, category, open]);
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30);
  }, [open]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-row="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function choose(item: PickItem) {
    setSelected(item);
    onChange?.(item);
    setOpen(false);
    setQuery("");
    setCategory(null);
    triggerRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(rows.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault(); // never submits the form from inside the search box
      if (rows[active]) choose(rows[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }
  }

  const qtyText = (i: PickItem) => (i.qty <= 0 ? <span className="font-medium text-red-600">none {qtyNote}</span> : <span>{`${i.qty} ${i.unit} ${qtyNote}`}</span>);

  const row = (i: PickItem, index: number) => (
    <li key={i.id} role="option" aria-selected={selected?.id === i.id} data-row={index}>
      <button
        type="button"
        onClick={() => choose(i)}
        onMouseMove={() => setActive(index)}
        className={`flex min-h-[48px] w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm ${index === active ? "bg-ink-100" : ""}`}
      >
        <span className="min-w-0">
          <span className="block truncate font-medium text-ink-900">{i.name}</span>
          <span className="block truncate text-xs text-ink-500">
            {isMaterialCategory(i.category) ? MATERIAL_CATEGORY_LABEL[i.category] : "Others"} · {qtyText(i)}
          </span>
        </span>
        {selected?.id === i.id && <span aria-hidden className="text-[#8a1a28]">✓</span>}
      </button>
    </li>
  );

  return (
    <div className="relative">
      <input type="hidden" name={name} value={selected?.id ?? ""} />
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={`${id}-list`}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-lg border border-ink-200 bg-ink-50 px-3 text-left text-sm text-ink-900 focus:border-[#8a1a28] focus:outline-none focus:ring-1 focus:ring-[#8a1a28]"
      >
        <span className={`min-w-0 truncate ${selected ? "" : "text-ink-400"}`}>{selected ? `${selected.name} (${selected.unit})` : placeholder}</span>
        <span aria-hidden className="text-ink-400">
          ▾
        </span>
      </button>
      {selected && <p className="mt-1 text-xs text-ink-500">{qtyText(selected)}</p>}

      {open && (
        <>
          <div aria-hidden className="fixed inset-0 z-40 bg-black/40 md:bg-transparent" onClick={() => setOpen(false)} />
          <div
            className="fixed inset-x-0 bottom-0 z-50 flex max-h-[80dvh] flex-col rounded-t-2xl border border-ink-200 bg-ink-50 shadow-xl md:absolute md:inset-x-auto md:bottom-auto md:left-0 md:top-full md:mt-1 md:max-h-[26rem] md:w-[30rem] md:max-w-[85vw] md:rounded-xl"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            <div className="space-y-2 border-b border-ink-100 p-3">
              <input
                ref={inputRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Type to find — e.g. pvc 2, cement…"
                aria-label="Search items"
                aria-controls={`${id}-list`}
                autoComplete="off"
                enterKeyHint="done"
                className="block min-h-[44px] w-full rounded-lg border border-ink-200 bg-ink-50 px-3 text-base text-ink-900 placeholder:text-ink-400 focus:border-[#8a1a28] focus:outline-none md:text-sm"
              />
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Category">
                {[{ value: null as string | null, label: "All" }, ...MATERIAL_CATEGORIES.map((c) => ({ value: c.value as string | null, label: SHORT[c.value] }))].map((c) => (
                  <button
                    key={c.label}
                    type="button"
                    aria-pressed={category === c.value}
                    onClick={() => setCategory(c.value)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium ${category === c.value ? "border-[#8a1a28] bg-[#8a1a28] text-white" : "border-ink-200 text-ink-700 hover:bg-ink-100"}`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
            <ul ref={listRef} id={`${id}-list`} role="listbox" className="min-h-0 flex-1 overflow-y-auto py-1">
              {recents.length > 0 && <li className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-ink-400">Recent</li>}
              {recents.map((i, n) => row(i, n))}
              {recents.length > 0 && shownMatches.length > 0 && <li className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-ink-400">All items</li>}
              {shownMatches.map((i, n) => row(i, recents.length + n))}
              {rows.length === 0 && <li className="px-4 py-6 text-center text-sm text-ink-500">Nothing matches — try fewer words or another category.</li>}
              {result.total > MAX_SHOWN && (
                <li className="px-4 py-2 text-center text-xs text-ink-500">
                  Showing the first {MAX_SHOWN} of {result.total} — type more to narrow it down.
                </li>
              )}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
