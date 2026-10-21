import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { php } from "@/lib/format";
import { ApiError, handleApi } from "@/lib/rbac";
import { advanceBalance, canApproveCash, formatCashAdvanceNo, isCashCustodian } from "@/lib/cash-expense";
import { requireCashExpenseUser } from "@/lib/cash-expense-db";

const patchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve") }),
  z.object({ action: z.literal("reject"), reason: z.string().trim().min(3).max(300) }),
  z.object({ action: z.literal("cancel") }),
  z.object({ action: z.literal("set_deduction"), deductionPerCutoff: z.coerce.number().positive().max(1_000_000) }),
  // Cash handed back directly, outside payroll.
  z.object({ action: z.literal("record_payment"), amount: z.coerce.number().positive().max(1_000_000), note: z.string().trim().max(200).optional() }),
]);

/**
 * PATCH /api/cash-advances/[id] — approve / reject (Owner), cancel (before anything was repaid), change the
 * per-cut-off deduction, or record a cash repayment (Owner/Accounting).
 */
export const PATCH = handleApi(async (req: NextRequest, { params }: { params: { id: string } }) => {
  const user = await requireCashExpenseUser();
  if (!isCashCustodian(user)) throw new ApiError(403, "Only the Owner or Accounting manages cash advances");
  const body = patchSchema.parse(await req.json());

  const a = await prisma.cashAdvance.findUnique({
    where: { id: params.id },
    include: { user: { select: { name: true } }, deductions: { select: { amount: true } } },
  });
  if (!a) throw new ApiError(404, "Cash advance not found");
  const no = formatCashAdvanceNo(a.number);
  const deducted = a.deductions.reduce((s, d) => s + Number(d.amount), 0);
  const balance = advanceBalance({ amount: a.amount, deducted });
  const expect = (...statuses: string[]) => {
    if (!statuses.includes(a.status)) throw new ApiError(400, `${no} is ${a.status.toLowerCase()} — that can't be done now`);
  };

  let action = "";
  let diff: Record<string, unknown> = { no, employee: a.user.name };

  if (body.action === "record_payment") {
    expect("ACTIVE");
    if (body.amount > balance + 0.005) throw new ApiError(400, `Only ${php(balance)} is left on ${no}`);
    await prisma.$transaction(async (db) => {
      await db.cashAdvanceDeduction.create({ data: { advanceId: a.id, amount: body.amount, note: body.note || "Cash repayment", recordedByName: user.name } });
      if (balance - body.amount <= 0.005) await db.cashAdvance.update({ where: { id: a.id }, data: { status: "PAID" } });
    });
    action = "CASH_ADVANCE_PAYMENT_RECORDED";
    diff = { ...diff, amount: body.amount, balanceAfter: Math.round((balance - body.amount) * 100) / 100 };
  } else {
    let data: Record<string, unknown> = {};
    switch (body.action) {
      case "approve":
        if (!canApproveCash(user)) throw new ApiError(403, "Only the Owner approves cash advances");
        expect("PENDING");
        data = { status: "ACTIVE", approvedByName: user.name, approvedAt: new Date() };
        action = "CASH_ADVANCE_APPROVED";
        break;
      case "reject":
        if (!canApproveCash(user)) throw new ApiError(403, "Only the Owner rejects cash advances");
        expect("PENDING");
        data = { status: "REJECTED", rejectedReason: body.reason };
        action = "CASH_ADVANCE_REJECTED";
        diff = { ...diff, reason: body.reason };
        break;
      case "cancel":
        expect("PENDING", "ACTIVE");
        if (deducted > 0) throw new ApiError(400, `${php(deducted)} has already been repaid on ${no}, so it can't be cancelled`);
        data = { status: "CANCELLED" };
        action = "CASH_ADVANCE_CANCELLED";
        break;
      case "set_deduction":
        expect("PENDING", "ACTIVE");
        data = { deductionPerCutoff: body.deductionPerCutoff };
        action = "CASH_ADVANCE_DEDUCTION_CHANGED";
        diff = { ...diff, from: Number(a.deductionPerCutoff), to: body.deductionPerCutoff };
        break;
    }
    const moved = await prisma.cashAdvance.updateMany({ where: { id: a.id, status: a.status }, data });
    if (moved.count === 0) throw new ApiError(409, `${no} was just changed by someone else — refresh and try again`);
  }

  await audit({ entityType: "CashAdvance", entityId: a.id, actorId: user.id, actorName: user.name, action, diff: diff as never });
  return NextResponse.json({ ok: true });
});

/**
 * DELETE /api/cash-advances/[id] — Owner only: remove a cash advance entered while testing (or by mistake), whatever its status,
 * together with its repayment records. Payroll runs and payslips already issued are never touched — they keep their own
 * snapshot of the deduction. The audit log keeps a full copy of the advance and its repayments.
 */
export const DELETE = handleApi(async (_req: NextRequest, { params }: { params: { id: string } }) => {
  const user = await requireCashExpenseUser();
  if (!canApproveCash(user)) throw new ApiError(403, "Only the Owner deletes cash advances");
  const a = await prisma.cashAdvance.findUnique({
    where: { id: params.id },
    include: { user: { select: { name: true } }, deductions: { include: { payrollRun: { select: { status: true } } }, orderBy: { createdAt: "asc" } } },
  });
  if (!a) throw new ApiError(404, "Cash advance not found");
  const no = formatCashAdvanceNo(a.number);

  await prisma.$transaction(async (db) => {
    await db.cashAdvanceDeduction.deleteMany({ where: { advanceId: a.id } });
    await db.cashAdvance.delete({ where: { id: a.id } });
  });

  await audit({
    entityType: "CashAdvance",
    entityId: a.id,
    actorId: user.id,
    actorName: user.name,
    action: "CASH_ADVANCE_DELETED",
    diff: {
      no,
      employee: a.user.name,
      status: a.status,
      amount: Number(a.amount),
      deductionPerCutoff: Number(a.deductionPerCutoff),
      reason: a.reason,
      createdBy: a.createdByName,
      approvedBy: a.approvedByName,
      repayments: a.deductions.map((d) => ({ amount: Number(d.amount), note: d.note, payrollRunId: d.payrollRunId, payrollRunStatus: d.payrollRun?.status ?? null, at: d.createdAt })),
    } as never,
  });
  return NextResponse.json({ ok: true });
});
