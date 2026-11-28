import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ApiError, handleApi } from "@/lib/rbac";
import { isCashCustodian } from "@/lib/cash-expense";
import { fundNoteProblem } from "@/lib/fund-ledger";
import { requireCashExpenseUser } from "@/lib/cash-expense-db";

const schema = z.object({
  amount: z.coerce.number().refine((n) => n !== 0 && Math.abs(n) <= 10_000_000, "enter an amount (negative to take cash out)"),
  note: z.string().trim().max(300).optional(),
});

/** POST /api/petty-cash/fund — Owner/Accounting put cash into the fund (replenishment) or correct it (negative). A note is required: where the cash came from, or why it is corrected. */
export const POST = handleApi(async (req: NextRequest) => {
  const user = await requireCashExpenseUser();
  if (!isCashCustodian(user)) throw new ApiError(403, "Only the Owner or Accounting manages the petty cash fund");
  const body = schema.parse(await req.json());
  const problem = fundNoteProblem(body.note);
  if (problem) throw new ApiError(400, problem);
  const note = body.note!.trim();
  const entry = await prisma.pettyCashFundEntry.create({
    data: { amount: body.amount, note, recordedById: user.id, recordedByName: user.name },
  });
  await audit({
    entityType: "PettyCashFundEntry",
    entityId: entry.id,
    actorId: user.id,
    actorName: user.name,
    action: body.amount > 0 ? "PETTY_CASH_FUND_REPLENISHED" : "PETTY_CASH_FUND_ADJUSTED",
    diff: { amount: body.amount, note },
  });
  return NextResponse.json(entry, { status: 201 });
});
