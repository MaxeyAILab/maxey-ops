import type { I18nKey } from "@/lib/i18n";

/**
 * What the floating "+" button can offer. Everyone starts with the main jobs they are allowed to do and can pick their own
 * set (up to 8) under My settings. An action only ever appears for someone who may actually do it.
 */
export const MAX_QUICK = 8;

export type QuickKind = "link" | "picker" | "search";

export interface QuickDef {
  key: string;
  labelKey: I18nKey;
  icon: string;
  kind: QuickKind;
  href?: string;
}

export const QUICK_CATALOG: QuickDef[] = [
  { key: "requisition", labelKey: "quick.requisition", icon: "📝", kind: "link", href: "/requisitions/new" },
  { key: "progress", labelKey: "quick.progress", icon: "🏗️", kind: "picker" },
  { key: "pettyCash", labelKey: "quick.pettyCash", icon: "💵", kind: "link", href: "/cash-expense/petty-cash#quick-record" },
  { key: "clock", labelKey: "quick.clock", icon: "⏱️", kind: "link", href: "/attendance" },
  { key: "delivery", labelKey: "quick.delivery", icon: "🚚", kind: "link", href: "/deliveries" },
  { key: "instructions", labelKey: "quick.instructions", icon: "📋", kind: "link", href: "/instructions" },
  { key: "payslip", labelKey: "quick.payslip", icon: "💰", kind: "link", href: "/payroll" },
  { key: "notifications", labelKey: "quick.notifications", icon: "🔔", kind: "link", href: "/notifications" },
  { key: "search", labelKey: "quick.search", icon: "🔍", kind: "search" },
];

/** What starts on the button before a person chooses: the main jobs, in this order. */
export const DEFAULT_QUICK = ["requisition", "progress", "pettyCash", "clock", "delivery"];

export interface QuickAccess {
  canRaiseRequisition: boolean;
  /** may post progress AND there is at least one project to post it on */
  canProgress: boolean;
  canUseCash: boolean;
  menus: string[];
  canVerifyDelivery: boolean;
}

/** The actions this person is allowed to have on the button, in catalogue order. */
export function eligibleQuick(a: QuickAccess): QuickDef[] {
  const ok: Record<string, boolean> = {
    requisition: a.canRaiseRequisition,
    progress: a.canProgress,
    pettyCash: a.canUseCash,
    clock: a.menus.includes("/attendance"),
    delivery: a.menus.includes("/deliveries") && a.canVerifyDelivery,
    instructions: a.menus.includes("/instructions"),
    payslip: a.menus.includes("/payroll"),
    notifications: true,
    search: true,
  };
  return QUICK_CATALOG.filter((q) => ok[q.key]);
}

/** The person's own choice (in their order, minus anything they can no longer do), or the default when they haven't chosen. */
export function resolveQuick(stored: string[] | null | undefined, eligible: QuickDef[]): QuickDef[] {
  const byKey = new Map(eligible.map((q) => [q.key, q]));
  const mine = Array.from(new Set(stored ?? []))
    .flatMap((k) => (byKey.has(k) ? [byKey.get(k)!] : []))
    .slice(0, MAX_QUICK);
  if (mine.length > 0) return mine;
  return DEFAULT_QUICK.flatMap((k) => (byKey.has(k) ? [byKey.get(k)!] : []));
}
