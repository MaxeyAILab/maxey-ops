import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hasInventoryOwnerPowers } from "@/lib/owner-authority";
import { audit } from "@/lib/audit";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import { canApproveInventoryRequest } from "@/lib/access";
import { savePhotos } from "@/lib/storage";
import { MAX_NEW_REQUEST_PHOTOS, photoRoom, withPhotos } from "@/lib/request-photos";
import { usedQtyStockChange } from "@/lib/used-qty-edit";
import { applyMaterialMove, assertMaterialAvailable, materialNeedsApproval } from "@/lib/inventory-requests";

const patchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve") }),
  z.object({ action: z.literal("reject"), reason: z.string().trim().min(3).max(300) }),
  z.object({ action: z.literal("cancel") }),
  z.object({ action: z.literal("add_photos"), photos: z.array(z.string()).min(1).max(MAX_NEW_REQUEST_PHOTOS) }),
  // Owner only: set or change the price a logged movement is valued at (for one that had no price when it was logged)
  z.object({ action: z.literal("set_price"), unitPrice: z.number().min(0).max(100_000_000).nullable(), alsoOtherUnpriced: z.boolean().optional() }),
  // Owner only: correct the quantity of a "Used on site" entry that was logged wrongly. The site stock is left alone unless asked.
  z.object({ action: z.literal("edit_used_qty"), qty: z.number().positive().max(1_000_000), reason: z.string().trim().min(3).max(300), adjustSiteStock: z.boolean().optional() }),
]);

/**
 * PATCH /api/inventory/movements/[id] — decide a return/transfer request. Office staff (and the Owner, PM, Purchasing)
 * approve or reject it; approving is what finally moves the stock, and the approver's name is kept. Nobody but the Owner decides
 * their own request. The person who asked can cancel it while it is still waiting.
 */
export const PATCH = handleApi(async (req: NextRequest, { params }: { params: { id: string } }) => {
  const user = await requireUser();
  const body = patchSchema.parse(await req.json());

  // Pricing a movement that already happened (an issue to a project that had no price when it was logged). The value of the
  // movement is what is charged to the project, so the Owner alone changes it, and the audit log keeps what it was before.
  if (body.action === "set_price") {
    if (!hasInventoryOwnerPowers(user)) throw new ApiError(403, "Only the Owner can change the price of a logged movement");
    const mv = await prisma.inventoryMovement.findUnique({ where: { id: params.id }, include: { item: { select: { name: true, unit: true } }, fromProject: { select: { name: true } }, toProject: { select: { name: true } } } });
    if (!mv) throw new ApiError(404, "Movement not found");
    if (mv.status !== "APPLIED") throw new ApiError(400, "Only a movement that has happened can be priced — this one is still waiting for approval or was rejected");
    const next = body.unitPrice === null ? null : Math.round(body.unitPrice * 100) / 100;
    const before = mv.unitPrice === null ? null : Number(mv.unitPrice);
    let others = 0;
    await prisma.$transaction(async (db) => {
      if (before !== next) await db.inventoryMovement.update({ where: { id: mv.id }, data: { unitPrice: next } });
      if (body.alsoOtherUnpriced && next !== null) {
        // the item's other movements that were also logged without a price get the same price
        others = (await db.inventoryMovement.updateMany({ where: { itemId: mv.itemId, unitPrice: null, status: "APPLIED", id: { not: mv.id } }, data: { unitPrice: next } })).count;
      }
    });
    if (before === next && others === 0) return NextResponse.json({ ok: true, unchanged: true });
    await audit({
      entityType: "InventoryMovement",
      entityId: mv.id,
      actorId: user.id,
      actorName: user.name,
      action: "INVENTORY_MOVEMENT_PRICED",
      diff: { item: mv.item.name, qty: Number(mv.qty), unit: mv.item.unit, from: mv.fromProject?.name ?? mv.fromLoc, to: mv.toProject?.name ?? mv.toLoc, priceBefore: before, priceNow: next, alsoPricedOtherMovements: others } as never,
    });
    return NextResponse.json({ ok: true, alsoPriced: others });
  }

  // Correcting the quantity of a usage that was logged wrongly. Only the record changes unless the Owner also wants the site stock to follow.
  if (body.action === "edit_used_qty") {
    if (!hasInventoryOwnerPowers(user)) throw new ApiError(403, "Only the Owner can change the quantity of a logged usage");
    const mv = await prisma.inventoryMovement.findUnique({ where: { id: params.id }, include: { item: { select: { name: true, unit: true } } } });
    if (!mv || mv.type !== "CONSUMED_ON_SITE") throw new ApiError(404, "Usage entry not found");
    if (mv.status !== "APPLIED") throw new ApiError(400, "Only a usage that has been recorded can be corrected");
    const before = Number(mv.qty);
    const next = Math.round(body.qty * 100) / 100;
    if (next === before) return NextResponse.json({ ok: true, unchanged: true });
    const back = usedQtyStockChange(before, next, !!body.adjustSiteStock);
    if (back < 0 && mv.fromProjectId) {
      const stock = await prisma.projectMaterialStock.findUnique({ where: { projectId_itemId: { projectId: mv.fromProjectId, itemId: mv.itemId } } });
      if (Number(stock?.qty ?? 0) < -back) throw new ApiError(400, `Not enough on site to take ${-back} ${mv.item.unit} more: ${mv.item.name} has ${Number(stock?.qty ?? 0)} ${mv.item.unit} there`);
    }
    await prisma.$transaction(async (db) => {
      const done = await db.inventoryMovement.updateMany({ where: { id: mv.id, status: "APPLIED", qty: mv.qty }, data: { qty: next } });
      if (done.count === 0) throw new ApiError(409, "This entry was just changed by someone else — reload and try again");
      if (back !== 0 && mv.fromProjectId) {
        await db.projectMaterialStock.upsert({
          where: { projectId_itemId: { projectId: mv.fromProjectId, itemId: mv.itemId } },
          create: { projectId: mv.fromProjectId, itemId: mv.itemId, qty: back },
          update: { qty: { increment: back } },
        });
      }
    });
    await audit({
      entityType: "InventoryMovement",
      entityId: mv.id,
      actorId: user.id,
      actorName: user.name,
      action: "INVENTORY_USAGE_QTY_CORRECTED",
      diff: { item: mv.item.name, unit: mv.item.unit, project: mv.fromLoc, qtyBefore: before, qtyNow: next, reason: body.reason, siteStockChange: back, siteStockAdjusted: !!body.adjustSiteStock } as never,
    });
    return NextResponse.json({ ok: true, siteStockChange: back });
  }

  const m = await prisma.inventoryMovement.findUnique({ where: { id: params.id }, include: { item: true, fromProject: { select: { name: true } }, toProject: { select: { name: true } } } });
  if (!m || !materialNeedsApproval(m.type)) throw new ApiError(404, "Request not found");
  if (m.status !== "PENDING") throw new ApiError(409, `This request was already ${m.status === "APPLIED" ? "approved" : "rejected"}`);
  const mine = m.actorId === user.id;
  const now = new Date();
  const label = `${Number(m.qty)} ${m.item.unit} ${m.item.name}`;

  // Photos of the items can be added while the request waits — by the person who asked, or by whoever approves it.
  if (body.action === "add_photos") {
    if (!mine && !canApproveInventoryRequest(user)) throw new ApiError(403, "Not authorized for this action");
    if (photoRoom(m.photos) === 0) throw new ApiError(400, "This request already has the most photos it can hold");
    const urls = await savePhotos(body.photos.slice(0, photoRoom(m.photos)));
    if (urls.length === 0) throw new ApiError(400, "The photo could not be read — try taking it again");
    const done = await prisma.inventoryMovement.updateMany({ where: { id: m.id, status: "PENDING" }, data: { photos: withPhotos(m.photos, urls) } });
    if (done.count === 0) throw new ApiError(409, "This request was just decided by someone else");
    await audit({ entityType: "InventoryMovement", entityId: m.id, actorId: user.id, actorName: user.name, action: "INVENTORY_REQUEST_PHOTOS_ADDED", diff: { item: m.item.name, qty: Number(m.qty), added: urls.length } });
    return NextResponse.json({ ok: true, photos: withPhotos(m.photos, urls) });
  }

  if (body.action === "cancel") {
    if (!mine) throw new ApiError(403, "Only the person who made the request can cancel it");
    const done = await prisma.inventoryMovement.updateMany({ where: { id: m.id, status: "PENDING" }, data: { status: "REJECTED", decidedById: user.id, decidedByName: user.name, decidedAt: now, rejectedReason: "Cancelled by the requester" } });
    if (done.count === 0) throw new ApiError(409, "This request was just decided by someone else");
    await audit({ entityType: "InventoryMovement", entityId: m.id, actorId: user.id, actorName: user.name, action: "INVENTORY_REQUEST_CANCELLED", diff: { item: m.item.name, qty: Number(m.qty) } });
    return NextResponse.json({ ok: true });
  }

  if (!canApproveInventoryRequest(user)) throw new ApiError(403, "Only office staff can approve or reject this");
  if (mine && !hasInventoryOwnerPowers(user)) throw new ApiError(403, "You can't approve your own request — another office staff member must");
  if (!hasInventoryOwnerPowers(user)) {
    const asker = await prisma.user.findUnique({ where: { id: m.actorId }, select: { name: true, inventoryRestricted: true } });
    if (asker?.inventoryRestricted) throw new ApiError(403, `Only the Owner (or a person with the Owner's inventory powers) can approve or reject ${asker.name}'s requests`);
  }

  if (body.action === "reject") {
    const done = await prisma.inventoryMovement.updateMany({ where: { id: m.id, status: "PENDING" }, data: { status: "REJECTED", decidedById: user.id, decidedByName: user.name, decidedAt: now, rejectedReason: body.reason } });
    if (done.count === 0) throw new ApiError(409, "This request was just decided by someone else");
    await audit({ entityType: "InventoryMovement", entityId: m.id, actorId: user.id, actorName: user.name, action: "INVENTORY_REQUEST_REJECTED", diff: { item: m.item.name, qty: Number(m.qty), reason: body.reason } });
    return NextResponse.json({ ok: true });
  }

  // approve: the stock has to still be there; then it moves in one step with the decision
  const move = { itemId: m.itemId, type: m.type, qty: Number(m.qty), fromProjectId: m.fromProjectId, toProjectId: m.toProjectId, excess: m.excess };
  await assertMaterialAvailable(move, m.item, { excludeMovementId: m.id });
  await prisma.$transaction(async (db) => {
    const done = await db.inventoryMovement.updateMany({ where: { id: m.id, status: "PENDING" }, data: { status: "APPLIED", decidedById: user.id, decidedByName: user.name, decidedAt: now } });
    if (done.count === 0) throw new ApiError(409, "This request was just decided by someone else");
    await applyMaterialMove(db, move);
  });
  await audit({ entityType: "InventoryMovement", entityId: m.id, actorId: user.id, actorName: user.name, action: "INVENTORY_REQUEST_APPROVED", diff: { item: m.item.name, qty: Number(m.qty), unit: m.item.unit, from: m.fromLoc, to: m.toLoc, label } });
  return NextResponse.json({ ok: true });
});
