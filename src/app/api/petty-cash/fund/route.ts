import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ApiError, handleApi } from "@/lib/rbac";
import { isCashCustodian } from "@/lib/cash-expense";
import { requireCashExpenseUser } from "@/lib/cash-expense-db";

const schema = z.object({
  amount: z.coerce.number().refine((n) => n !== 0 && Math.abs(n) <= 10_000_000, "enter an amount (negative to take cash out)"),
  note: z.string().trim().max(300).optional(),
});

/** POST /api/petty-cash/fund — Owner/Accounting put cash into the fund (replenishment) or correct it (negative). */
export const POST = handleApi(async (req: NextRequest) => {
  const user = await requireCashExpenseUser();
  if (!isCashCustodian(user)) throw new ApiError(403, "Only the Owner or Accounting manages the petty cash fund");
  const body = schema.parse(await req.json());
  const entry = await prisma.pettyCashFundEntry.create({
    data: { amount: body.amount, note: body.note || null, recordedById: user.id, recordedByName: user.name },
  });
  await audit({
    entityType: "PettyCashFundEntry",
    entityId: entry.id,
    actorId: user.id,
    actorName: user.name,
    action: body.amount > 0 ? "PETTY_CASH_FUND_REPLENISHED" : "PETTY_CASH_FUND_ADJUSTED",
    diff: { amount: body.amount, note: body.note ?? null },
  });
  return NextResponse.json(entry, { status: 201 });
});
