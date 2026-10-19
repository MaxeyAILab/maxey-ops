import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ApiError, handleApi } from "@/lib/rbac";
import { canApproveCash, formatCashAdvanceNo, isCashCustodian } from "@/lib/cash-expense";
import { requireCashExpenseUser, withNextNumber } from "@/lib/cash-expense-db";

const createSchema = z
  .object({
    userId: z.string().min(1),
    amount: z.coerce.number().positive().max(1_000_000),
    deductionPerCutoff: z.coerce.number().positive().max(1_000_000),
    reason: z.string().trim().min(3).max(500),
    // The Owner recording an advance can approve and release it in the same step.
    approveNow: z.boolean().optional(),
  })
  .refine((b) => b.deductionPerCutoff <= b.amount, { message: "the per-cut-off deduction can't be more than the advance", path: ["deductionPerCutoff"] });

/**
 * POST /api/cash-advances — Owner/Accounting record a worker's cash advance (an emergency loan) and how much comes
 * off each payroll cut-off. It starts PENDING for the Owner; once approved it's ACTIVE and every new payroll run
 * starts with the deduction filled in until the advance is paid.
 */
export const POST = handleApi(async (req: NextRequest) => {
  const user = await requireCashExpenseUser();
  if (!isCashCustodian(user)) throw new ApiError(403, "Only the Owner or Accounting records cash advances");
  const body = createSchema.parse(await req.json());
  if (body.approveNow && !canApproveCash(user)) throw new ApiError(403, "Only the Owner approves cash advances");

  const worker = await prisma.user.findFirst({ where: { id: body.userId, active: true, role: { not: "CLIENT" } }, select: { id: true, name: true } });
  if (!worker) throw new ApiError(400, "Employee: pick an active staff member");

  const now = new Date();
  const created = await withNextNumber(
    async () => (await prisma.cashAdvance.aggregate({ _max: { number: true } }))._max.number,
    (number) =>
      prisma.cashAdvance.create({
        data: {
          number,
          userId: worker.id,
          amount: body.amount,
          deductionPerCutoff: body.deductionPerCutoff,
          reason: body.reason,
          createdById: user.id,
          createdByName: user.name,
          ...(body.approveNow ? { status: "ACTIVE", approvedByName: user.name, approvedAt: now } : {}),
        },
      })
  );

  await audit({
    entityType: "CashAdvance",
    entityId: created.id,
    actorId: user.id,
    actorName: user.name,
    action: body.approveNow ? "CASH_ADVANCE_APPROVED" : "CASH_ADVANCE_REQUESTED",
    diff: { no: formatCashAdvanceNo(created.number), employee: worker.name, amount: body.amount, perCutoff: body.deductionPerCutoff, reason: body.reason },
  });
  return NextResponse.json(created, { status: 201 });
});
