import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canUseCashExpense } from "@/lib/access";
import { fmtDate, php } from "@/lib/format";
import { manilaDayKey } from "@/lib/time-rules";
import { advanceBalance, CASH_ADVANCE_STATUS_LABEL, canApproveCash, formatCashAdvanceNo, isCashCustodian } from "@/lib/cash-expense";
import { CashExpenseHeader, CashIcons, CashStat, CashStatus, Panel } from "@/components/cash-expense-header";
import { AdvanceActions, CashAdvanceForm } from "@/components/cash-expense-actions";

export const metadata = { title: "Cash Advance" };
export const dynamic = "force-dynamic";

/**
 * Cash Advance: emergency loans to workers. Owner/Accounting record one with the amount to take off each payroll
 * cut-off; once the Owner approves it, every new payroll run starts with that deduction filled in, and approving the
 * run posts it here, until the balance reaches zero.
 */
export default async function CashAdvancePage() {
  const user = await getSessionUser();
  if (!user || !canUseCashExpense(user)) redirect("/attendance");
  if (!isCashCustodian(user)) redirect("/cash-expense/petty-cash");
  const canApprove = canApproveCash(user);

  const [advances, people] = await Promise.all([
    prisma.cashAdvance.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: { name: true, employeeNo: true } },
        deductions: {
          orderBy: { createdAt: "asc" },
          include: { payrollRun: { select: { id: true, periodStart: true, periodEnd: true, department: true, project: { select: { name: true } } } } },
        },
      },
    }),
    prisma.user.findMany({ where: { active: true, role: { not: "CLIENT" } }, select: { id: true, name: true, employeeNo: true }, orderBy: { name: "asc" } }),
  ]);

  const monthStart = new Date(`${manilaDayKey(new Date()).slice(0, 7)}-01T00:00:00+08:00`);
  const rows = advances.map((a) => {
    const repaid = a.deductions.reduce((s, d) => s + Number(d.amount), 0);
    return { ...a, repaid, balance: advanceBalance({ amount: a.amount, deducted: repaid }) };
  });
  const active = rows.filter((a) => a.status === "ACTIVE");
  const outstanding = active.reduce((s, a) => s + a.balance, 0);
  const repaidThisMonth = rows.flatMap((a) => a.deductions).filter((d) => d.createdAt >= monthStart).reduce((s, d) => s + Number(d.amount), 0);
  const pending = rows.filter((a) => a.status === "PENDING");

  return (
    <div className="space-y-6">
      <CashExpenseHeader tab="cash-advance" title="Cash Advance" subtitle="Emergency cash loans to workers, repaid through payroll deductions every cut-off." showAdvances />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <CashStat icon={CashIcons.cash} tone="green" label="Outstanding Balance" value={php(outstanding)} sub="Still to be deducted" />
        <CashStat icon={CashIcons.people} tone="violet" label="Active Advances" value={active.length} sub={`${new Set(active.map((a) => a.userId)).size} worker(s)`} />
        <CashStat icon={CashIcons.trend} tone="blue" label="Repaid This Month" value={php(repaidThisMonth)} />
        <CashStat icon={CashIcons.clock} tone="amber" label="Pending Approval" value={pending.length} sub={pending.length ? php(pending.reduce((s, a) => s + Number(a.amount), 0)) : undefined} />
      </div>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.6fr)]">
        <Panel title="Record Cash Advance">
          <CashAdvanceForm people={people.map((p) => ({ value: p.id, label: p.employeeNo ? `${p.name} (${p.employeeNo})` : p.name }))} canApprove={canApprove} />
        </Panel>

        <Panel title="Cash Advances">
          <div className="overflow-x-auto rounded-lg border border-ink-200">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-ink-100/70 text-ink-700">
                <tr>
                  <th className="px-4 py-3 font-semibold">Employee</th>
                  <th className="px-3 py-3 text-right font-semibold">Amount</th>
                  <th className="px-3 py-3 text-right font-semibold">Per cut-off</th>
                  <th className="px-3 py-3 text-right font-semibold">Repaid</th>
                  <th className="px-3 py-3 text-right font-semibold">Balance</th>
                  <th className="px-3 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id} className="border-t border-ink-100 align-top">
                    <td className="px-4 py-4">
                      <div className="font-medium text-ink-900">{a.user.name}</div>
                      <div className="text-xs text-ink-500">
                        {formatCashAdvanceNo(a.number)} · {fmtDate(a.createdAt)} · {a.reason}
                      </div>
                      {a.status === "REJECTED" && a.rejectedReason && <div className="text-xs text-red-700 dark:text-red-300">Rejected: {a.rejectedReason}</div>}
                      {a.deductions.length > 0 && (
                        <details className="mt-1.5 text-xs">
                          <summary className="cursor-pointer text-[#8a1a28] dark:text-rose-300">Repayments ({a.deductions.length})</summary>
                          <ul className="mt-1 space-y-0.5 text-ink-600">
                            {a.deductions.map((d) => (
                              <li key={d.id}>
                                {fmtDate(d.createdAt)} · {php(d.amount)} ·{" "}
                                {d.payrollRun ? (
                                  <Link href={`/payroll/${d.payrollRun.id}`} className="hover:underline">
                                    payroll {d.payrollRun.project?.name ?? d.payrollRun.department?.toLowerCase()} {fmtDate(d.payrollRun.periodStart)} – {fmtDate(d.payrollRun.periodEnd)}
                                  </Link>
                                ) : (
                                  (d.note ?? "Cash repayment")
                                )}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                      <div className="mt-2">
                        <AdvanceActions id={a.id} status={a.status} canApprove={canApprove} repaid={a.repaid > 0} />
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-4 text-right tabular-nums">{php(a.amount)}</td>
                    <td className="whitespace-nowrap px-3 py-4 text-right tabular-nums">{php(a.deductionPerCutoff)}</td>
                    <td className="whitespace-nowrap px-3 py-4 text-right tabular-nums">{php(a.repaid)}</td>
                    <td className="whitespace-nowrap px-3 py-4 text-right font-semibold tabular-nums">{php(a.balance)}</td>
                    <td className="whitespace-nowrap px-3 py-4">
                      <CashStatus status={a.status} label={CASH_ADVANCE_STATUS_LABEL[a.status]} />
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-ink-500">
                      No cash advances recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  );
}
