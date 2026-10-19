import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { savePhotos } from "@/lib/storage";
import { php } from "@/lib/format";
import { ApiError, handleApi } from "@/lib/rbac";
import { canApproveCash, formatPettyCashNo, fundBalance, isCashCustodian, itemsTotal } from "@/lib/cash-expense";
import { requireCashExpenseUser } from "@/lib/cash-expense-db";

const itemSchema = z.object({ description: z.string().trim().min(1).max(200), amount: z.coerce.number().min(0).max(1_000_000) });

const patchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve") }),
  z.object({ action: z.literal("reject"), reason: z.string().trim().min(3).max(300) }),
  z.object({ action: z.literal("release") }),
  z.object({ action: z.literal("cancel") }),
  z.object({
    action: z.literal("liquidate"),
    items: z.array(itemSchema).min(1).max(30),
    receipts: z.array(z.string()).max(6).optional(),
    note: z.string().trim().max(500).optional(),
    // A custodian liquidating with the receipts in hand can verify in the same step.
    verify: z.boolean().optional(),
  }),
  z.object({ action: z.literal("verify") }),
  z.object({ action: z.literal("send_back"), reason: z.string().trim().min(3).max(300) }),
]);

/**
 * PATCH /api/petty-cash/[id] — move a request through its life: approve / reject (Owner), release the cash
 * (Owner/Accounting, from the fund), cancel (the requester before release; a pending one also by whoever filed it or
 * Accounting; an approved one also by the Owner, e.g. approved by mistake), liquidate (only the person the cash was
 * released to reports what was spent), verify or send back a liquidation (Owner/Accounting). Verifying posts the spent
 * amount as an expense of the request's project — or company overhead when it has none — and returns any change to
 * the fund.
 */
export const PATCH = handleApi(async (req: NextRequest, { params }: { params: { id: string } }) => {
  const user = await requireCashExpenseUser();
  const body = patchSchema.parse(await req.json());
  const r = await prisma.pettyCashRequest.findUnique({ where: { id: params.id }, include: { requestedBy: { select: { name: true } } } });
  if (!r) throw new ApiError(404, "Request not found");
  const custodian = isCashCustodian(user);
  const own = r.requestedById === user.id || r.createdById === user.id;
  const isRequester = r.requestedById === user.id;
  if (!custodian && !own) throw new ApiError(404, "Request not found");
  const no = formatPettyCashNo(r.number);
  const expect = (...statuses: string[]) => {
    if (!statuses.includes(r.status)) throw new ApiError(400, `${no} is ${r.status.toLowerCase().replace("_", " ")} — that can't be done now`);
  };

  let data: Record<string, unknown> = {};
  let action = "";
  let diff: Record<string, unknown> = { no };

  switch (body.action) {
    case "approve":
      if (!canApproveCash(user)) throw new ApiError(403, "Only the Owner approves petty cash");
      expect("PENDING");
      data = { status: "APPROVED", approvedByName: user.name, approvedAt: new Date() };
      action = "PETTY_CASH_APPROVED";
      break;
    case "reject":
      if (!canApproveCash(user)) throw new ApiError(403, "Only the Owner rejects petty cash");
      expect("PENDING", "APPROVED");
      data = { status: "REJECTED", rejectedReason: body.reason };
      action = "PETTY_CASH_REJECTED";
      diff = { ...diff, reason: body.reason };
      break;
    case "release": {
      if (!custodian) throw new ApiError(403, "Only the Owner or Accounting releases petty cash");
      expect("APPROVED");
      const [fund, requests] = await Promise.all([
        prisma.pettyCashFundEntry.findMany({ select: { amount: true } }),
        prisma.pettyCashRequest.findMany({ select: { status: true, amount: true, spentAmount: true } }),
      ]);
      const balance = fundBalance(fund, requests);
      if (balance < Number(r.amount)) {
        throw new ApiError(400, `The petty cash fund has only ${php(balance)} — replenish the fund before releasing ${php(r.amount)}`);
      }
      data = { status: "RELEASED", releasedByName: user.name, releasedAt: new Date() };
      action = "PETTY_CASH_RELEASED";
      diff = { ...diff, amount: Number(r.amount), fundBefore: balance };
      break;
    }
    case "cancel":
      expect("PENDING", "APPROVED");
      // Once approved, only the requester (no longer needed) or the Owner (approved by mistake) can call it off.
      if (r.status === "APPROVED" && !isRequester && !canApproveCash(user)) {
        throw new ApiError(403, "An approved request can only be cancelled by the Owner or the requester");
      }
      data = { status: "CANCELLED" };
      action = r.status === "APPROVED" ? "PETTY_CASH_APPROVAL_CANCELLED" : "PETTY_CASH_CANCELLED";
      diff = { ...diff, from: r.status };
      break;
    case "liquidate": {
      expect("RELEASED", "FOR_LIQUIDATION");
      // The person who received the cash reports what it was spent on — no one reports it for them.
      if (!isRequester) throw new ApiError(403, `Only ${r.requestedBy.name}, who received the cash, can report what it was spent on`);
      if (body.verify && !custodian) throw new ApiError(403, "Only the Owner or Accounting verifies a liquidation");
      const spent = itemsTotal(body.items);
      const newReceipts = await savePhotos(body.receipts);
      const receipts = [...((r.liquidationReceipts as string[] | null) ?? []), ...newReceipts];
      const now = new Date();
      data = {
        status: body.verify ? "LIQUIDATED" : "FOR_LIQUIDATION",
        spentAmount: spent,
        liquidationItems: body.items,
        liquidationReceipts: receipts.length ? receipts : undefined,
        liquidationNote: body.note || null,
        liquidationSubmittedAt: now,
        ...(body.verify ? { liquidatedByName: user.name, liquidatedAt: now } : {}),
      };
      action = body.verify ? "PETTY_CASH_LIQUIDATED" : "PETTY_CASH_LIQUIDATION_SUBMITTED";
      diff = { ...diff, released: Number(r.amount), spent, change: Math.round((Number(r.amount) - spent) * 100) / 100 };
      break;
    }
    case "verify":
      if (!custodian) throw new ApiError(403, "Only the Owner or Accounting verifies a liquidation");
      expect("FOR_LIQUIDATION");
      data = { status: "LIQUIDATED", liquidatedByName: user.name, liquidatedAt: new Date() };
      action = "PETTY_CASH_LIQUIDATED";
      diff = { ...diff, released: Number(r.amount), spent: Number(r.spentAmount ?? 0) };
      break;
    case "send_back":
      if (!custodian) throw new ApiError(403, "Only the Owner or Accounting reviews a liquidation");
      expect("FOR_LIQUIDATION");
      data = { status: "RELEASED", liquidationNote: `Sent back: ${body.reason}` };
      action = "PETTY_CASH_LIQUIDATION_SENT_BACK";
      diff = { ...diff, reason: body.reason };
      break;
  }

  // Only from the status we read — two people acting at once can't both move it.
  const moved = await prisma.pettyCashRequest.updateMany({ where: { id: r.id, status: r.status }, data });
  if (moved.count === 0) throw new ApiError(409, `${no} was just changed by someone else — refresh and try again`);

  await audit({ entityType: "PettyCashRequest", entityId: r.id, actorId: user.id, actorName: user.name, action, diff: diff as never });
  return NextResponse.json({ ok: true });
});

/**
 * DELETE /api/petty-cash/[id] — Owner only: remove a released request whose receipts haven't been verified (released
 * by mistake, or the cash came back unused). Its cash counts as back in the fund. A liquidated request is a posted
 * expense and can't be deleted. The audit log keeps a full copy of what was removed.
 */
export const DELETE = handleApi(async (_req: NextRequest, { params }: { params: { id: string } }) => {
  const user = await requireCashExpenseUser();
  if (!canApproveCash(user)) throw new ApiError(403, "Only the Owner deletes released petty cash");
  const r = await prisma.pettyCashRequest.findUnique({
    where: { id: params.id },
    include: { requestedBy: { select: { name: true } }, project: { select: { name: true } } },
  });
  if (!r) throw new ApiError(404, "Request not found");
  const no = formatPettyCashNo(r.number);
  if (r.status !== "RELEASED" && r.status !== "FOR_LIQUIDATION") {
    throw new ApiError(400, r.status === "LIQUIDATED" ? `${no} is already a posted expense and can't be deleted` : `${no} isn't released — cancel or reject it instead`);
  }
  const gone = await prisma.pettyCashRequest.deleteMany({ where: { id: r.id, status: r.status } });
  if (gone.count === 0) throw new ApiError(409, `${no} was just changed by someone else — refresh and try again`);

  await audit({
    entityType: "PettyCashRequest",
    entityId: r.id,
    actorId: user.id,
    actorName: user.name,
    action: "PETTY_CASH_DELETED",
    diff: {
      no,
      status: r.status,
      amount: Number(r.amount),
      spent: r.spentAmount == null ? null : Number(r.spentAmount),
      project: r.project?.name ?? null,
      requestedBy: r.requestedBy.name,
      purpose: r.purpose,
      releasedBy: r.releasedByName,
      releasedAt: r.releasedAt,
    },
  });
  return NextResponse.json({ ok: true });
});
