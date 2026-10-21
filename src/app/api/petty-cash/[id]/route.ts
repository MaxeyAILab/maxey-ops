import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { savePhotos } from "@/lib/storage";
import { php } from "@/lib/format";
import { ApiError, handleApi } from "@/lib/rbac";
import { MAX_LIQUIDATION_RECEIPTS, canApproveCash, canApprovePettyCash, canAttachReceipts, canReleasePettyCash, formatPettyCashNo, fundBalance, isCashCustodian, itemsTotal, receiptCount, seesAllPettyCash } from "@/lib/cash-expense";
import { requireCashExpenseUser } from "@/lib/cash-expense-db";

const itemSchema = z.object({ description: z.string().trim().min(1).max(200), amount: z.coerce.number().min(0).max(1_000_000) });

const patchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve") }),
  z.object({ action: z.literal("reject"), reason: z.string().trim().min(3).max(300) }),
  z.object({ action: z.literal("release") }),
  z.object({ action: z.literal("confirm_receipt") }),
  z.object({ action: z.literal("cancel") }),
  z.object({
    action: z.literal("liquidate"),
    items: z.array(itemSchema).min(1).max(30),
    receipts: z.array(z.string()).max(6).optional(),
    note: z.string().trim().max(500).optional(),
    // A custodian liquidating with the receipts in hand can verify in the same step.
    verify: z.boolean().optional(),
  }),
  // Receipts forgotten at the time can be added afterwards — while it waits for verification and after it is posted.
  z.object({ action: z.literal("add_receipts"), receipts: z.array(z.string()).min(1).max(6) }),
  z.object({ action: z.literal("verify") }),
  z.object({ action: z.literal("send_back"), reason: z.string().trim().min(3).max(300) }),
]);

/**
 * PATCH /api/petty-cash/[id] — move a request through its life: approve / reject (the Owner and assigned approvers),
 * release the cash from the fund (assigned releasers, or the Owner), confirm receipt (the requester, in the app, once
 * they have the cash), cancel (the requester before release; a pending one also by whoever filed it or Accounting; an
 * approved one also by an approver, e.g. approved by mistake), liquidate (only the requester, after confirming
 * receipt, reports what was spent), verify or send back a liquidation (Owner/Accounting). Verifying posts the spent
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
  if (!seesAllPettyCash(user) && !own) throw new ApiError(404, "Request not found");
  const no = formatPettyCashNo(r.number);
  const expect = (...statuses: string[]) => {
    if (!statuses.includes(r.status)) throw new ApiError(400, `${no} is ${r.status.toLowerCase().replace("_", " ")} — that can't be done now`);
  };

  let data: Record<string, unknown> = {};
  let action = "";
  let diff: Record<string, unknown> = { no };

  switch (body.action) {
    case "approve":
      if (!canApprovePettyCash(user)) throw new ApiError(403, "You aren't set up to approve petty cash");
      expect("PENDING");
      data = { status: "APPROVED", approvedByName: user.name, approvedAt: new Date() };
      action = "PETTY_CASH_APPROVED";
      break;
    case "reject":
      if (!canApprovePettyCash(user)) throw new ApiError(403, "You aren't set up to approve or reject petty cash");
      expect("PENDING", "APPROVED");
      data = { status: "REJECTED", rejectedReason: body.reason };
      action = "PETTY_CASH_REJECTED";
      diff = { ...diff, reason: body.reason };
      break;
    case "release": {
      if (!canReleasePettyCash(user)) throw new ApiError(403, "You aren't set up to release petty cash");
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
    case "confirm_receipt":
      // The requester's own word, in the app, that the released cash reached them.
      if (!isRequester) throw new ApiError(403, `Only ${r.requestedBy.name} can confirm receiving this cash`);
      expect("RELEASED");
      if (r.receivedAt) throw new ApiError(400, `${no}: you already confirmed receiving this cash`);
      data = { receivedAt: new Date() };
      action = "PETTY_CASH_RECEIPT_CONFIRMED";
      diff = { ...diff, amount: Number(r.amount), releasedBy: r.releasedByName };
      break;
    case "cancel":
      expect("PENDING", "APPROVED");
      // Once approved, only the requester (no longer needed) or the Owner (approved by mistake) can call it off.
      if (r.status === "PENDING" && !own && !custodian && !canApprovePettyCash(user)) {
        throw new ApiError(403, "Only the requester, whoever filed it, Accounting or an approver can cancel this request");
      }
      if (r.status === "APPROVED" && !isRequester && !canApprovePettyCash(user)) {
        throw new ApiError(403, "An approved request can only be cancelled by an approver or the requester");
      }
      data = { status: "CANCELLED" };
      action = r.status === "APPROVED" ? "PETTY_CASH_APPROVAL_CANCELLED" : "PETTY_CASH_CANCELLED";
      diff = { ...diff, from: r.status };
      break;
    case "liquidate": {
      expect("RELEASED", "FOR_LIQUIDATION");
      // The person who received the cash reports what it was spent on — no one reports it for them.
      if (!isRequester) throw new ApiError(403, `Only ${r.requestedBy.name}, who received the cash, can report what it was spent on`);
      if (!r.receivedAt) throw new ApiError(400, `Confirm that you received the cash for ${no} first`);
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
      // Turned in with no receipt: still accepted (it can be attached later), but flagged to the Owner and Accounting.
      const noReceipts = receipts.length === 0;
      action = body.verify ? "PETTY_CASH_LIQUIDATED" : noReceipts ? "PETTY_CASH_LIQUIDATION_NO_RECEIPT" : "PETTY_CASH_LIQUIDATION_SUBMITTED";
      diff = { ...diff, released: Number(r.amount), spent, change: Math.round((Number(r.amount) - spent) * 100) / 100, ...(noReceipts ? { noReceipts: true } : {}) };
      break;
    }
    case "add_receipts": {
      expect("FOR_LIQUIDATION", "LIQUIDATED");
      if (!canAttachReceipts(user, r)) throw new ApiError(403, "Only the requester, whoever filed it, the Owner or Accounting can attach receipts");
      const have = receiptCount(r);
      if (have + body.receipts.length > MAX_LIQUIDATION_RECEIPTS) throw new ApiError(400, `${no} can hold ${MAX_LIQUIDATION_RECEIPTS} receipt photos — it already has ${have}`);
      const added = await savePhotos(body.receipts);
      if (added.length === 0) throw new ApiError(400, "Those pictures couldn't be read — try again");
      // Only receipts change: the amounts, the status and any posted expense stay exactly as they were.
      data = { liquidationReceipts: [...((r.liquidationReceipts as string[] | null) ?? []), ...added] };
      action = "PETTY_CASH_RECEIPT_ADDED";
      diff = { ...diff, added: added.length, total: have + added.length, status: r.status, hadNone: have === 0 };
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
 * by mistake, or the cash came back unused) — its cash counts as back in the fund — or clear away a cancelled or
 * rejected one so the list stays tidy. A liquidated request is a posted expense and can't be deleted; pending and
 * approved ones are cancelled or rejected first. The audit log keeps a full copy of what was removed.
 */
export const DELETE = handleApi(async (_req: NextRequest, { params }: { params: { id: string } }) => {
  const user = await requireCashExpenseUser();
  if (!canApproveCash(user)) throw new ApiError(403, "Only the Owner deletes petty cash requests");
  const r = await prisma.pettyCashRequest.findUnique({
    where: { id: params.id },
    include: { requestedBy: { select: { name: true } }, project: { select: { name: true } } },
  });
  if (!r) throw new ApiError(404, "Request not found");
  const no = formatPettyCashNo(r.number);
  if (!["RELEASED", "FOR_LIQUIDATION", "CANCELLED", "REJECTED"].includes(r.status)) {
    throw new ApiError(400, r.status === "LIQUIDATED" ? `${no} is already a posted expense and can't be deleted` : `${no} is still open — cancel or reject it first`);
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
