import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { canAccess } from "@/lib/access";
import { ApiError, requireUser } from "@/lib/rbac";
import { allocateDeduction, plannedDeduction, type AdvanceLike } from "@/lib/cash-expense";
import { normalizeEntries, type PayrollEntry } from "@/lib/payroll";

/** Signed-in staff with the Cash Expense tab (API side of the same menu rule the pages use). */
export async function requireCashExpenseUser() {
  const user = await requireUser();
  if (!canAccess(user.role, user.department, "/cash-expense", user.customMenus, user.useCustomMenus)) {
    throw new ApiError(403, "Not authorized for Cash Expense");
  }
  return user;
}

/** Creates a numbered record, retrying if two people file at the same moment and pick the same next number. */
export async function withNextNumber<T>(maxNumber: () => Promise<number | null>, create: (n: number) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const n = ((await maxNumber()) ?? 0) + 1;
    try {
      return await create(n);
    } catch (e) {
      if (attempt < 4 && e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue;
      throw e;
    }
  }
}

type Db = Prisma.TransactionClient | typeof prisma;

/** A person's approved, not-yet-paid advances with what's already been repaid on each. */
async function activeAdvances(db: Db, userIds: string[]): Promise<Map<string, AdvanceLike[]>> {
  if (userIds.length === 0) return new Map();
  const rows = await db.cashAdvance.findMany({
    where: { userId: { in: userIds }, status: "ACTIVE" },
    include: { deductions: { select: { amount: true } } },
  });
  const map = new Map<string, AdvanceLike[]>();
  for (const a of rows) {
    const list = map.get(a.userId) ?? [];
    list.push({
      id: a.id,
      amount: a.amount,
      deductionPerCutoff: a.deductionPerCutoff,
      createdAt: a.createdAt,
      deducted: a.deductions.reduce((s, d) => s + Number(d.amount), 0),
    });
    map.set(a.userId, list);
  }
  return map;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** What's left of a payslip line for a cash-advance deduction after the other deductions. */
function payRoom(e: PayrollEntry, cashAdvance = 0) {
  return Math.max(0, r2(e.gross - e.sss - e.philhealth - e.pagibig - (e.meals ?? 0) - cashAdvance));
}

/**
 * A newly generated payroll run starts with each person's cash-advance deduction filled in: one cut-off's amount per
 * active advance, less what other open runs already plan to take, and never more than the pay left after the other
 * deductions. Staff can still change it on the run before approving.
 */
export async function prefillCashAdvances(entries: PayrollEntry[]): Promise<PayrollEntry[]> {
  const advances = await activeAdvances(prisma, entries.map((e) => e.userId));
  if (advances.size === 0) return entries;

  const openRuns = await prisma.payrollRun.findMany({ where: { status: { in: ["DRAFT", "REVIEW"] } }, select: { entries: true } });
  const planned = new Map<string, number>();
  for (const run of openRuns) {
    for (const e of normalizeEntries(run.entries as unknown as PayrollEntry[])) {
      if (e.cashAdvance > 0) planned.set(e.userId, (planned.get(e.userId) ?? 0) + e.cashAdvance);
    }
  }

  return entries.map((e) => {
    const list = advances.get(e.userId);
    if (!list) return e;
    const cashAdvance = r2(Math.min(plannedDeduction(list, planned.get(e.userId) ?? 0), payRoom(e)));
    if (cashAdvance <= 0) return e;
    return { ...e, cashAdvance, net: payRoom(e, cashAdvance) };
  });
}

/**
 * When a run is approved, each payslip's cash-advance deduction is posted against that person's advances (oldest
 * first); an advance paid down to zero is marked fully paid.
 */
export async function postCashAdvanceDeductions(db: Prisma.TransactionClient, runId: string, actorName: string) {
  const run = await db.payrollRun.findUnique({ where: { id: runId } });
  if (!run) return;
  const entries = normalizeEntries(run.entries as unknown as PayrollEntry[]).filter((e) => e.cashAdvance > 0);
  if (entries.length === 0) return;
  const advances = await activeAdvances(db, entries.map((e) => e.userId));
  for (const e of entries) {
    const list = advances.get(e.userId);
    if (!list) continue;
    for (const part of allocateDeduction(e.cashAdvance, list)) {
      await db.cashAdvanceDeduction.create({
        data: { advanceId: part.advanceId, payrollRunId: runId, amount: part.amount, recordedByName: actorName, note: "Payroll deduction" },
      });
      const a = list.find((x) => x.id === part.advanceId)!;
      a.deducted = r2(a.deducted + part.amount);
      if (r2(Number(a.amount) - a.deducted) <= 0) await db.cashAdvance.update({ where: { id: a.id }, data: { status: "PAID" } });
    }
  }
}

/** Undo a run's posted deductions (its approval was cancelled, or the run deleted); paid-off advances become active again. */
export async function reverseCashAdvanceDeductions(db: Prisma.TransactionClient, runId: string) {
  const rows = await db.cashAdvanceDeduction.findMany({ where: { payrollRunId: runId }, select: { advanceId: true } });
  if (rows.length === 0) return;
  await db.cashAdvanceDeduction.deleteMany({ where: { payrollRunId: runId } });
  await db.cashAdvance.updateMany({ where: { id: { in: rows.map((r) => r.advanceId) }, status: "PAID" }, data: { status: "ACTIVE" } });
}
