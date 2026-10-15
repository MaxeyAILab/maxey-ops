import { prisma } from "@/lib/prisma";
import { normalizeEntries, type PayrollEntry } from "@/lib/payroll";
import { nextPersonSlipRef, slipYear } from "@/lib/payslip";

/**
 * Gives every payslip on an approved run its reference number, once. The number is the person's own running count
 * of payslips that year: "2026-020" is their 20th payslip of 2026. It continues from the highest number they already
 * hold in any run that year, or from the count they had before this system started numbering (PayslipBaseline),
 * whichever is higher. A number already on a payslip never changes — cancelling an approval, editing and approving
 * again keeps it — and only entries still without one are numbered. A database lock makes two approvals at the same
 * moment take turns. Safe to call again: it only fills in what is missing.
 */
export async function ensureSlipRefs(runId: string) {
  return prisma.$transaction(async (db) => {
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('payslip-refs'))`;
    const run = await db.payrollRun.findUnique({ where: { id: runId } });
    if (!run || (run.status !== "APPROVED" && run.status !== "PAID")) return run;

    const entries = normalizeEntries(run.entries as unknown as PayrollEntry[]);
    const missing = entries.filter((e) => !e.slipRef);
    if (missing.length === 0) return run;

    const year = slipYear(run.periodEnd);
    const everyRun = await db.payrollRun.findMany({ select: { entries: true } });
    const refsByUser = new Map<string, string[]>();
    for (const r of everyRun) {
      for (const e of normalizeEntries(r.entries as unknown as PayrollEntry[])) {
        if (e.slipRef) refsByUser.set(e.userId, [...(refsByUser.get(e.userId) ?? []), e.slipRef]);
      }
    }
    const baselines = await db.payslipBaseline.findMany({ where: { year, userId: { in: missing.map((e) => e.userId) } } });
    const baselineOf = new Map(baselines.map((b) => [b.userId, b.count]));

    const refFor = new Map(missing.map((e) => [e.userId, nextPersonSlipRef(refsByUser.get(e.userId) ?? [], baselineOf.get(e.userId) ?? 0, year)]));
    const updatedEntries = entries.map((e) => (e.slipRef ? e : { ...e, slipRef: refFor.get(e.userId) }));
    return db.payrollRun.update({ where: { id: run.id }, data: { entries: updatedEntries as never } });
  });
}
