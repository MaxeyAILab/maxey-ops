import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { DEFAULT_CLOSEOUT_TEMPLATE } from "@/lib/closeout";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("template"), projectId: z.string().min(1) }),
  z.object({
    action: z.literal("add"),
    projectId: z.string().min(1),
    title: z.string().trim().min(3).max(200),
    category: z.string().trim().max(60).optional().nullable(),
    required: z.boolean().optional().default(true),
  }),
]);

/**
 * POST /api/closeout — Owner/PM start a project's closeout checklist from the standard
 * template (only if it has no checklist yet, so applying twice can't duplicate it) or add a
 * custom item.
 */
export const POST = handleApi(async (req: NextRequest) => {
  const user = await requireUser(["OWNER", "PM"]);
  const body = schema.parse(await req.json());

  const project = await prisma.project.findUnique({ where: { id: body.projectId }, select: { id: true, name: true } });
  if (!project) throw new ApiError(404, "Project not found");

  if (body.action === "template") {
    const created = await prisma.$transaction(async (db) => {
      // Lock the project row so two simultaneous "apply template" clicks run one after the other.
      await db.$queryRaw`SELECT id FROM "Project" WHERE id = ${project.id} FOR UPDATE`;
      const existing = await db.closeoutItem.count({ where: { projectId: project.id } });
      if (existing > 0) throw new ApiError(409, "This project already has a closeout checklist");
      await db.closeoutItem.createMany({
        data: DEFAULT_CLOSEOUT_TEMPLATE.map((t, i) => ({ projectId: project.id, title: t.title, category: t.category, required: t.required, sortOrder: i + 1 })),
      });
      return DEFAULT_CLOSEOUT_TEMPLATE.length;
    });
    await audit({ entityType: "Project", entityId: project.id, actorId: user.id, actorName: user.name, action: "CLOSEOUT_TEMPLATE_APPLIED", diff: { project: project.name, items: created } });
    return NextResponse.json({ ok: true, items: created }, { status: 201 });
  }

  const last = await prisma.closeoutItem.aggregate({ where: { projectId: project.id }, _max: { sortOrder: true } });
  const item = await prisma.closeoutItem.create({
    data: { projectId: project.id, title: body.title, category: body.category || null, required: body.required, sortOrder: (last._max.sortOrder ?? 0) + 1 },
  });
  await audit({ entityType: "CloseoutItem", entityId: item.id, actorId: user.id, actorName: user.name, action: "CLOSEOUT_ITEM_ADDED", diff: { project: project.name, title: body.title, required: body.required } });
  return NextResponse.json(item, { status: 201 });
});
