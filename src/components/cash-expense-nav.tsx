"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Sidebar group for Cash Expense: the parent link plus its three pages, the current one highlighted. */
export function CashExpenseNav({ showAdvances }: { showAdvances: boolean }) {
  const path = usePathname() ?? "";
  const links = [
    { href: "/cash-expense/petty-cash", label: "Petty Cash" },
    ...(showAdvances ? [{ href: "/cash-expense/cash-advance", label: "Cash Advance" }] : []),
    { href: "/cash-expense/report", label: "Petty Cash Report" },
  ];
  return (
    <div className="mt-3 border-t border-ink-100 pt-3">
      <Link
        href="/cash-expense/petty-cash"
        className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${
          path.startsWith("/cash-expense") ? "text-ink-900" : "text-ink-600 hover:bg-brand-50 hover:text-brand-700"
        }`}
      >
        <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-lime-100 text-base">
          💵
        </span>
        <span className="flex-1">Cash Expense</span>
        <span aria-hidden className="text-xs text-ink-400">▾</span>
      </Link>
      <div className="mt-1 space-y-0.5">
        {links.map((l) => {
          const active = path.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-3 rounded-lg py-2 pl-6 pr-3 text-sm ${
                active ? "bg-[#8a1a28] font-semibold text-white" : "text-ink-600 hover:bg-ink-100 hover:text-ink-900"
              }`}
            >
              <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${active ? "bg-white" : "bg-ink-400"}`} />
              {l.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
