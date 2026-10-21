import { MATERIAL_CATEGORIES, isMaterialCategory, type MaterialCategoryValue } from "@/lib/material-category";

/**
 * The value of what is in the warehouse: quantity × price per unit, added up. Items with no price entered yet are not counted
 * (and are reported, so the total is never mistaken for complete). Pure, shared by the pages and the tests.
 */
export interface ValuedItem {
  category: string;
  currentQty: unknown;
  unitPrice: unknown;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const cents = (n: number) => Math.round(n * 100) / 100;

/** One line: quantity × price, or null when there is no price. */
export function lineValue(qty: unknown, price: unknown): number | null {
  const p = num(price);
  if (p === null) return null;
  // worked out in whole centavos so half a centavo always rounds up (12.5 × ₱19.99 = ₱249.88, not ₱249.87)
  return Math.round((num(qty) ?? 0) * Math.round(p * 100)) / 100;
}

export interface ValueSummary {
  total: number;
  /** items that have a price (their value is in the total) */
  priced: number;
  /** items with no price yet (not in the total) */
  unpriced: number;
  byCategory: Record<MaterialCategoryValue, { value: number; items: number; unpriced: number }>;
}

export function summarizeValue(items: ValuedItem[]): ValueSummary {
  const byCategory = Object.fromEntries(MATERIAL_CATEGORIES.map((c) => [c.value, { value: 0, items: 0, unpriced: 0 }])) as ValueSummary["byCategory"];
  let total = 0;
  let priced = 0;
  let unpriced = 0;
  for (const i of items) {
    const key = isMaterialCategory(i.category) ? i.category : "OTHERS";
    byCategory[key].items += 1;
    const v = lineValue(i.currentQty, i.unitPrice);
    if (v === null) {
      unpriced += 1;
      byCategory[key].unpriced += 1;
    } else {
      priced += 1;
      total += v;
      byCategory[key].value = cents(byCategory[key].value + v);
    }
  }
  return { total: cents(total), priced, unpriced, byCategory };
}

/** A price typed in a box ("1,250.50", " 75 ", "") → a number, null for blank, or undefined when it is not a usable price. */
export function parsePrice(raw: string): number | null | undefined {
  const t = raw.replace(/[,₱\s]/g, "");
  if (t === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return undefined;
  const n = Number(t);
  return n <= 100_000_000 ? n : undefined;
}

/** A material movement as far as its value is concerned. */
export interface ValuedMovement {
  type: string;
  status: string;
  qty: unknown;
  /** the price per unit remembered when it was logged */
  unitPrice: unknown;
  createdAt: Date;
}

export interface IssuedSummary {
  monthValue: number;
  monthCount: number;
  allValue: number;
  allCount: number;
  /** issues with no price remembered (not in the values) */
  unpriced: number;
}

/**
 * What has gone OUT of the warehouse to project sites: movements issued from the warehouse that were applied (a pending request
 * or a rejected one moved nothing), valued at the price per unit remembered when they were logged. `monthStart` is the first
 * moment of the current month.
 */
export function issuedFromWarehouse(movements: ValuedMovement[], monthStart: Date): IssuedSummary {
  const out: IssuedSummary = { monthValue: 0, monthCount: 0, allValue: 0, allCount: 0, unpriced: 0 };
  for (const m of movements) {
    if (m.type !== "WAREHOUSE_TO_SITE" || m.status !== "APPLIED") continue;
    out.allCount += 1;
    const monthly = m.createdAt >= monthStart;
    if (monthly) out.monthCount += 1;
    const v = lineValue(m.qty, m.unitPrice);
    if (v === null) {
      out.unpriced += 1;
      continue;
    }
    out.allValue = Math.round((out.allValue + v) * 100) / 100;
    if (monthly) out.monthValue = Math.round((out.monthValue + v) * 100) / 100;
  }
  return out;
}
