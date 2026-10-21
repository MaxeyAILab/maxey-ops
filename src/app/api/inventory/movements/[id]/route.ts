import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import { canApproveInventoryRequest } from "@/lib/access";
import { applyMaterialMove, assertMaterialAvailable, materialNeedsApproval } from "@/lib/inventory-requests";

const patchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve") }),
  z.object({ action: z.literal("reject"), reason: z.string().trim().min(3).max(300) }),
  z.object({ action: z.literal("cancel") }),
]);

/**
 * PATCH /api/inventory/movements/[id] — decide a return/transfer request. Office staff (and the Owner, PM, Purchasing)
 * approve or reject it; approving is what finally moves the stock, and the approver's name is kept. Nobody but the Owner decides
 * their own request. The person who asked can cancel it while it is still waiting.
 */
export const PATCH = handleApi(async (req: NextRequest, { params }: { params: { id: string } }) => {
  const user = await requireUser();
  const body = patchSchema.parse(await req.json());
  const m = await prisma.inventoryMovement.findUnique({ where: { id: params.id }, include: { item: true, fromProject: { select: { name: true } }, toProject: { select: { name: true } } } });
  if (!m || !materialNeedsApproval(m.type)) throw new ApiError(404, "Request not found");
  if (m.status !== "PENDING") throw new ApiError(409, `This request was already ${m.status === "APPLIED" ? "approved" : "rejected"}`);
  const mine = m.actorId === user.id;
  const now = new Date();
  const label = `${Number(m.qty)} ${m.item.unit} ${m.item.name}`;

  if (body.action === "cancel") {
    if (!mine) throw new ApiError(403, "Only the person who made the request can cancel it");
    const done = await prisma.inventoryMovement.updateMany({ where: { id: m.id, status: "PENDING" }, data: { status: "REJECTED", decidedById: user.id, decidedByName: user.name, decidedAt: now, rejectedReason: "Cancelled by the requester" } });
    if (done.count === 0) throw new ApiError(409, "This request was just decided by someone else");
    await audit({ entityType: "InventoryMovement", entityId: m.id, actorId: user.id, actorName: user.name, action: "INVENTORY_REQUEST_CANCELLED", diff: { item: m.item.name, qty: Number(m.qty) } });
    return NextResponse.json({ ok: true });
  }

  if (!canApproveInventoryRequest(user)) throw new ApiError(403, "Only office staff can approve or reject this");
  if (mine && user.role !== "OWNER") throw new ApiError(403, "You can't approve your own request — another office staff member must");

  if (body.action === "reject") {
    const done = await prisma.inventoryMovement.updateMany({ where: { id: m.id, status: "PENDING" }, data: { status: "REJECTED", decidedById: user.id, decidedByName: user.name, decidedAt: now, rejectedReason: body.reason } });
    if (done.count === 0) throw new ApiError(409, "This request was just decided by someone else");
    await audit({ entityType: "InventoryMovement", entityId: m.id, actorId: user.id, actorName: user.name, action: "INVENTORY_REQUEST_REJECTED", diff: { item: m.item.name, qty: Number(m.qty), reason: body.reason } });
    return NextResponse.json({ ok: true });
  }

  // approve: the stock has to still be there; then it moves in one step with the decision
  const move = { itemId: m.itemId, type: m.type, qty: Number(m.qty), fromProjectId: m.fromProjectId, toProjectId: m.toProjectId };
  await assertMaterialAvailable(move, m.item, { excludeMovementId: m.id });
  await prisma.$transaction(async (db) => {
    const done = await db.inventoryMovement.updateMany({ where: { id: m.id, status: "PENDING" }, data: { status: "APPLIED", decidedById: user.id, decidedByName: user.name, decidedAt: now } });
    if (done.count === 0) throw new ApiError(409, "This request was just decided by someone else");
    await applyMaterialMove(db, move);
  });
  await audit({ entityType: "InventoryMovement", entityId: m.id, actorId: user.id, actorName: user.name, action: "INVENTORY_REQUEST_APPROVED", diff: { item: m.item.name, qty: Number(m.qty), unit: m.item.unit, from: m.fromLoc, to: m.toLoc, label } });
  return NextResponse.json({ ok: true });
});
