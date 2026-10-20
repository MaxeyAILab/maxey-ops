import type { I18nKey } from "@/lib/i18n";
import { CASH_TAB } from "@/lib/mobile-tabs";

export type ChipTone = "sky" | "violet" | "amber" | "indigo" | "orange" | "blue" | "teal" | "slate" | "emerald" | "pink" | "cyan" | "rose";

export interface NavItem {
  href: string;
  labelKey: I18nKey;
  icon: string;
  chip: ChipTone;
}

/** Every tab in the app's menu, in menu order. Which of them a person sees depends on their access (see lib/access.ts). */
export const NAV: NavItem[] = [
  { href: "/dashboard", labelKey: "nav.dashboard", icon: "📊", chip: "sky" },
  { href: "/finance", labelKey: "nav.finance", icon: "💵", chip: "rose" },
  { href: "/leads", labelKey: "nav.leads", icon: "📥", chip: "violet" },
  { href: "/projects", labelKey: "nav.projects", icon: "🏗️", chip: "amber" },
  { href: "/requisitions", labelKey: "nav.requisitions", icon: "📝", chip: "indigo" },
  { href: "/purchasing", labelKey: "nav.purchasing", icon: "🛒", chip: "orange" },
  { href: "/deliveries", labelKey: "nav.deliveries", icon: "🚚", chip: "blue" },
  { href: "/inventory", labelKey: "nav.inventory", icon: "📦", chip: "teal" },
  { href: "/instructions", labelKey: "nav.instructions", icon: "📋", chip: "slate" },
  { href: "/attendance", labelKey: "nav.attendance", icon: "⏱️", chip: "emerald" },
  { href: "/payroll", labelKey: "nav.payroll", icon: "💰", chip: "pink" },
  { href: "/people", labelKey: "nav.people", icon: "👥", chip: "cyan" },
];

/** Cash Expense sits beside the tab checklist (everyone on staff has it) but can go on the bottom bar like any other tab. */
export const CASH_ITEM = { href: CASH_TAB, labelKey: "nav.cash" as I18nKey, icon: "💵" };
/** Cash Expense is too long for a bottom-bar button, so the bar says "Cash". */
export const CASH_BAR_LABEL: I18nKey = "nav.cashShort";

/** The icon and label key for any tab that can go on the bottom bar. */
export function tabInfo(href: string): { labelKey: I18nKey; icon: string } | null {
  if (href === CASH_TAB) return CASH_ITEM;
  return NAV.find((n) => n.href === href) ?? null;
}
