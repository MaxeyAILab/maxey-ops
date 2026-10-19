"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface SidebarItem {
  href: string;
  label: string;
  icon: string;
  chipClass: string;
  badge: number;
}

/** Pages that live under another tab: a quotation is opened from Leads / CRM. */
const PARENT_TAB: Record<string, string> = { "/quotations": "/leads" };

function activeHref(path: string, items: SidebarItem[]): string | null {
  const first = "/" + (path.split("/")[1] ?? "");
  const tab = PARENT_TAB[first] ?? first;
  return items.some((i) => i.href === tab) ? tab : null;
}

const ACTIVE = "bg-[#8a1a28] font-semibold text-white shadow-sm";

/** The sidebar's tab list; the tab for the page you're on is highlighted in burgundy (same as Cash Expense). */
export function SidebarNav({ items }: { items: SidebarItem[] }) {
  const current = activeHref(usePathname() ?? "", items);
  return (
    <>
      {items.map((n) => {
        const on = n.href === current;
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={on ? "page" : undefined}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${
              on
                ? ACTIVE
                : n.badge > 0
                  ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                  : "text-ink-600 hover:bg-brand-50 hover:text-brand-700"
            }`}
          >
            <span aria-hidden className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-base ${n.chipClass}`}>
              {n.icon}
            </span>
            <span className="flex-1">{n.label}</span>
            {n.badge > 0 && (
              <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white">
                {n.badge}
              </span>
            )}
          </Link>
        );
      })}
    </>
  );
}

/** The same tabs in the phone top bar, current one highlighted. */
export function MobileNav({ items, showCashExpense }: { items: SidebarItem[]; showCashExpense: boolean }) {
  const path = usePathname() ?? "";
  const current = activeHref(path, items);
  const cashOn = path.startsWith("/cash-expense");
  const cls = (on: boolean, badge = 0) =>
    `flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 font-medium ${
      on ? ACTIVE : badge > 0 ? "bg-emerald-50 text-emerald-700" : "text-ink-900 hover:bg-ink-100"
    }`;
  return (
    <>
      {items.map((n) => (
        <Link key={n.href} href={n.href} aria-current={n.href === current ? "page" : undefined} className={cls(n.href === current, n.badge)}>
          {n.label}
          {n.badge > 0 && (
            <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white">
              {n.badge}
            </span>
          )}
        </Link>
      ))}
      {showCashExpense && (
        <Link href="/cash-expense/petty-cash" aria-current={cashOn ? "page" : undefined} className={cls(cashOn)}>
          Cash Expense
        </Link>
      )}
    </>
  );
}
