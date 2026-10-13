import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";

const patchSchema = z.object({
  done: z.boolean().optional(),
  note: z.string().max(1000).optional().nullable(),
  required: z.boolean().optional(),
  title: z.string().trim().min(3).max(200).optional(),
});

/**
 * PATCH /api/closeout/[id] — Owner/PM tick an item done (recording who and when), untick it,
 * or edit it. Ticking an item that's already ticked is a harmless no-op rather than an error,
 * and the change is a conditional update so two people can't both "win".
 */
export const PATCH = handleApi(async (req: NextRequest, { params }: { params: { id: string } }) => {
  const user = await requireUser(["OWNER", "PM"]);
  const body = patchSchema.parse(await req.json());

  const item = await prisma.closeoutItem.findUnique({ where: { id: params.id }, include: { project: { select: { name: true } } } });
  if (!item) throw new ApiError(404, "Checklist item not found");

  if (body.done !== undefined && body.done !== item.done) {
    const res = await prisma.closeoutItem.updateMany({
      where: { id: item.id, done: item.done },
      data: body.done
        ? { done: true, doneById: user.id, doneByName: user.name, doneAt: new Date() }
        : { done: false, doneById: null, doneByName: null, doneAt: null },
    });
    if (res.count === 0) throw new ApiError(409, "Someone just changed this item — refresh the page");
    await audit({
      entityType: "CloseoutItem",
      entityId: item.id,
      actorId: user.id,
      actorName: user.name,
      action: body.done ? "CLOSEOUT_ITEM_DONE" : "CLOSEOUT_ITEM_UNDONE",
      diff: { project: item.project.name, title: item.title },
    });
  }

  if (body.note !== undefined || body.required !== undefined || body.title !== undefined) {
    await prisma.closeoutItem.update({
      where: { id: item.id },
      data: {
        ...(body.note !== undefined ? { note: body.note || null } : {}),
        ...(body.required !== undefined ? { required: body.required } : {}),
        ...(body.title !== undefined ? { title: body.title } : {}),
      },
    });
    await audit({ entityType: "CloseoutItem", entityId: item.id, actorId: user.id, actorName: user.name, action: "CLOSEOUT_ITEM_EDITED", diff: { project: item.project.name, title: body.title ?? item.title, required: body.required ?? item.required } });
  }
  return NextResponse.json({ ok: true });
});

export const DELETE = handleApi(async (_req: NextRequest, { params }: { params: { id: string } }) => {
  const user = await requireUser(["OWNER", "PM"]);
  const item = await prisma.closeoutItem.findUnique({ where: { id: params.id }, include: { project: { select: { name: true } } } });
  if (!item) throw new ApiError(404, "Checklist item not found");
  await prisma.closeoutItem.delete({ where: { id: item.id } });
  await audit({ entityType: "CloseoutItem", entityId: item.id, actorId: user.id, actorName: user.name, action: "CLOSEOUT_ITEM_REMOVED", diff: { project: item.project.name, title: item.title, wasDone: item.done } });
  return NextResponse.json({ ok: true });
});
