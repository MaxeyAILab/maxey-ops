import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { handleApi, requireUser } from "@/lib/rbac";

const createSchema = z.object({
  amount: z.coerce.number().min(0),
  note: z.string().max(200).optional().or(z.literal("")),
});

/**
 * POST /api/finance/cash-snapshot — Owner manually records what the bank
 * app shows right now. No bank integration exists, so this is the source of
 * truth for the Finance tab's "cash on hand" figure. Append-only: each check
 * is its own row, the Finance tab always reads the latest.
 */
export const POST = handleApi(async (req: NextRequest) => {
  const user = await requireUser(["OWNER"]);
  const body = createSchema.parse(await req.json());

  const snapshot = await prisma.cashSnapshot.create({
    data: { amount: body.amount, note: body.note || null, recordedById: user.id },
  });

  await audit({
    entityType: "CashSnapshot",
    entityId: snapshot.id,
    actorId: user.id,
    actorName: user.name,
    action: "CASH_SNAPSHOT_RECORDED",
    diff: { amount: body.amount, note: body.note || null },
  });

  return NextResponse.json(snapshot, { status: 201 });
});
