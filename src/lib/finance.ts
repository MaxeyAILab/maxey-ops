import { prisma } from "@/lib/prisma";
import type { PayrollEntry } from "@/lib/payroll";

/**
 * Project & company cashflow figures (Spec 6.13).
 * Committed cost = issued PO totals + approved-but-not-yet-PO'd requisition
 * estimates + approved/paid payroll (labor) — all post automatically.
 */

export interface ProjectFinance {
  id: string;
  name: string;
  clientName: string;
  status: string;
  contractValue: number;
  received: number;
  receivable: number;
  committedCost: number;
  laborCost: number;
  grossMargin: number;
  marginPct: number;
  retentionHeld: number;
  latestProgressPct: number;
}

/** Labor cost of a run = employer payout (gross pay of all entries). */
export function runGross(entries: unknown): number {
  return (entries as PayrollEntry[]).reduce((s, e) => s + e.gross, 0);
}

export async function getProjectFinances(): Promise<ProjectFinance[]> {
  const projects = await prisma.project.findMany({
    // running-business view: exclude shelved and turned-over projects
    where: { status: { notIn: ["NOT_ACTIVE", "TURNED_OVER"] } },
    include: {
      client: { select: { name: true } },
      payments: true,
      paymentTerms: true,
      requisitions: {
        include: { purchaseOrder: true },
        where: { status: { in: ["APPROVED", "PO_ISSUED", "DELIVERED"] } },
      },
      payrollRuns: { where: { status: { in: ["APPROVED", "PAID"] } } },
      progressEntries: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { createdAt: "desc" },
  });

  return projects.map((p) => {
    const contractValue = Number(p.contractValue);
    const received = p.payments.reduce((s, x) => s + Number(x.amount), 0);
    const laborCost = p.payrollRuns.reduce((s, r) => s + runGross(r.entries), 0);
    const committedCost =
      laborCost +
      p.requisitions.reduce((s, r) => {
        if (r.purchaseOrder) return s + Number(r.purchaseOrder.totalCost);
        return s + Number(r.estimatedCost ?? 0);
      }, 0);
    const retentionHeld = p.paymentTerms
      .filter((t) => t.type === "RETENTION" && t.status !== "PAID")
      .reduce((s, t) => s + Number(t.amount), 0);
    const grossMargin = contractValue - committedCost;
    return {
      id: p.id,
      name: p.name,
      clientName: p.client.name,
      status: p.status,
      contractValue,
      received,
      receivable: Math.max(contractValue - received, 0),
      committedCost,
      laborCost,
      grossMargin,
      marginPct: contractValue > 0 ? (grossMargin / contractValue) * 100 : 0,
      retentionHeld,
      latestProgressPct: Number(p.progressEntries[0]?.pctComplete ?? 0),
    };
  });
}

export interface MonthlyCashflow {
  month: string; // "Jan 2026"
  inflow: number; // client payments received
  outflow: number; // PO commitments issued
}

export async function getMonthlyCashflow(months = 6): Promise<MonthlyCashflow[]> {
  const since = new Date();
  since.setMonth(since.getMonth() - (months - 1));
  since.setDate(1);
  since.setHours(0, 0, 0, 0);

  const [payments, pos] = await Promise.all([
    prisma.payment.findMany({ where: { dateReceived: { gte: since } } }),
    prisma.purchaseOrder.findMany({ where: { createdAt: { gte: since } } }),
  ]);

  const fmt = new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    year: "numeric",
  });

  const buckets: MonthlyCashflow[] = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(since);
    d.setMonth(d.getMonth() + i);
    buckets.push({ month: fmt.format(d), inflow: 0, outflow: 0 });
  }
  const idx = (d: Date) => buckets.findIndex((b) => b.month === fmt.format(d));

  for (const p of payments) {
    const i = idx(new Date(p.dateReceived));
    if (i >= 0) buckets[i].inflow += Number(p.amount);
  }
  for (const po of pos) {
    const i = idx(new Date(po.createdAt));
    if (i >= 0) buckets[i].outflow += Number(po.totalCost);
  }
  return buckets;
}
