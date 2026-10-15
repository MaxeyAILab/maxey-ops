import { prisma } from "@/lib/prisma";
import { normalizeEntries, type PayrollEntry } from "@/lib/payroll";
import { nextSlipRefs, slipYear } from "@/lib/payslip";

/**
 * Gives every payslip on an approved run its reference number ("2026-009"), once. Numbers continue after the
 * highest already issued that year across all runs, are handed out in name order, and are never changed or
 * reused — a reprint always carries the same number. A database lock makes two approvals at the same moment
 * take turns instead of both issuing the same number. Safe to call again: it only fills in what is missing.
 */
export async function ensureSlipRefs(runId: string) {
  return prisma.$transaction(async (db) => {
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('payslip-refs'))`;
    const run = await db.payrollRun.findUnique({ where: { id: runId } });
    if (!run || (run.status !== "APPROVED" && run.status !== "PAID")) return run;

    const entries = normalizeEntries(run.entries as unknown as PayrollEntry[]);
    const missing = entries.filter((e) => !e.slipRef).sort((a, b) => a.name.localeCompare(b.name));
    if (missing.length === 0) return run;

    const year = slipYear(run.periodEnd);
    const everyRun = await db.payrollRun.findMany({ select: { entries: true } });
    const issued = everyRun.flatMap((r) => normalizeEntries(r.entries as unknown as PayrollEntry[]).map((e) => e.slipRef));
    const refs = nextSlipRefs(issued, year, missing.length);
    const refFor = new Map(missing.map((e, i) => [e.userId, refs[i]]));

    const updatedEntries = entries.map((e) => (e.slipRef ? e : { ...e, slipRef: refFor.get(e.userId) }));
    return db.payrollRun.update({ where: { id: run.id }, data: { entries: updatedEntries as never } });
  });
}
