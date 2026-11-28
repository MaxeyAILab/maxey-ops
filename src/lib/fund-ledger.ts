/**
 * The petty cash fund's replenishment trail (owner's request 2026-11-28): every entry that added cash to the fund (or corrected it),
 * oldest first with a running number, and how much cash was in the fund right after it. Pure rules, shared by the page and the tests.
 */
import { cashOut, fundBalance, liquidationReturn, type PettyCashLike } from "@/lib/cash-expense";

type Money = number | string | { toString(): string } | null | undefined;
const num = (m: Money) => (m == null ? 0 : Number(m.toString()));
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Every new fund entry needs a note (owner's rule 2026-11-28): where the cash came from, or why it is being corrected. */
export const MIN_FUND_NOTE = 3;
export function fundNoteProblem(note: string | null | undefined): string | null {
  return (note ?? "").trim().length >= MIN_FUND_NOTE ? null : "Say where the cash came from (or why it is being corrected), e.g. “Check #1023 encashed”";
}

export interface FundEntryRow {
  id: string;
  amount: Money;
  createdAt: Date;
}

export interface LedgerRow<E> {
  entry: E;
  /** 1 = the very first entry ever; never changes (entries can't be deleted) */
  no: number;
  /** what this entry put into the fund; negative = cash taken out / a correction */
  amount: number;
  kind: "added" | "correction";
  /** cash in the fund right after this entry (releases and returned change up to that moment included); null when it can't be worked out */
  balanceAfter: number | null;
}

export type RequestMoney = PettyCashLike & { releasedAt?: Date | null; liquidatedAt?: Date | null };

/**
 * Entries oldest first. The balance after each one is the fund's whole history up to that moment: entries so far, less cash released,
 * plus unspent change put back when a liquidation was verified. It is only shown when that history adds up exactly to today's fund
 * balance (so a request without its release/verify time can never make it wrong); otherwise `reconciled` is false and every
 * balanceAfter is null.
 */
export function fundLedger<E extends FundEntryRow>(entries: E[], requests: RequestMoney[]): { rows: LedgerRow<E>[]; reconciled: boolean } {
  const sorted = [...entries].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  const events: { t: number; delta: number }[] = [];
  for (const r of requests) {
    if (r.releasedAt && cashOut(r) !== 0) events.push({ t: r.releasedAt.getTime(), delta: -cashOut(r) });
    if (r.liquidatedAt && liquidationReturn(r) !== 0) events.push({ t: r.liquidatedAt.getTime(), delta: liquidationReturn(r) });
  }
  events.sort((a, b) => a.t - b.t);

  const placed = r2(sorted.reduce((s, e) => s + num(e.amount), 0) + events.reduce((s, e) => s + e.delta, 0));
  const reconciled = Math.abs(placed - fundBalance(entries, requests)) < 0.005;

  let funded = 0;
  let moved = 0;
  let next = 0;
  const rows = sorted.map((e, i) => {
    funded += num(e.amount);
    const t = e.createdAt.getTime();
    while (next < events.length && events[next].t <= t) moved += events[next++].delta;
    const amount = r2(num(e.amount));
    return { entry: e, no: i + 1, amount, kind: amount > 0 ? ("added" as const) : ("correction" as const), balanceAfter: reconciled ? r2(funded + moved) : null };
  });
  return { rows, reconciled };
}

/** What a list of ledger rows put into the fund, split into replenishments and corrections. */
export function ledgerTotals<E>(rows: LedgerRow<E>[]): { added: number; corrections: number; net: number; addedCount: number; correctionCount: number } {
  const added = r2(rows.filter((r) => r.kind === "added").reduce((s, r) => s + r.amount, 0));
  const corrections = r2(rows.filter((r) => r.kind === "correction").reduce((s, r) => s + r.amount, 0));
  return { added, corrections, net: r2(added + corrections), addedCount: rows.filter((r) => r.kind === "added").length, correctionCount: rows.filter((r) => r.kind === "correction").length };
}
