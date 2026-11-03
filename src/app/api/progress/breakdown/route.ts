import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { checkBreakdown, computeWorkItemStatuses, currentBreakdown, currentWeight } from "@/lib/progress";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";

const schema = z.object({
  projectId: z.string().min(1),
  workItem: z.string().trim().min(1).max(200),
  /** the work item's weight (% of the project) — the sub-items' weights must add up to exactly this */
  weight: z.coerce.number().gt(0).max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().or(z.literal("")),
  /** empty = take the sub-items away and report the item as a whole again */
  items: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        weight: z.coerce.number().gt(0).max(100),
        /** the sub-item's completion now; when left out, a sub-item that already exists keeps its own and a new one starts at the item's current completion */
        pctComplete: z.coerce.number().min(0).max(100).optional(),
      })
    )
    .max(40),
});

/**
 * POST /api/progress/breakdown — PM / Owner only. Sets (or changes, or takes away) the sub-items of a work item, e.g. Earthfilling
 * and Compaction (40%) → earthfill materials 15%, spreading 10%, compaction 15%. The sub-items' weights are shares of the whole
 * project and must add up to exactly the work item's weight. This is recorded as approved entries (one per sub-item, plus a
 * "removed" marker for a sub-item that was taken out) so the history stays and the project total is unchanged: the work item's
 * completion becomes the weighted average of its sub-items, and each sub-item is then reported like any other progress entry.
 */
export const POST = handleApi(async (req: NextRequest) => {
  const user = await requireUser(["OWNER", "PM"]);
  const body = schema.parse(await req.json());

  const project = await prisma.project.findUnique({ where: { id: body.projectId }, select: { id: true, name: true } });
  if (!project) throw new ApiError(400, "Unknown project");

  const entries = await prisma.progressEntry.findMany({
    where: { projectId: body.projectId },
    select: { id: true, workItem: true, weight: true, createdAt: true, reviewStatus: true, subItem: true, subWeight: true, pctComplete: true, color: true },
  });
  const item = body.workItem.trim();
  const known = currentWeight(entries, item);
  const error = checkBreakdown(entries, { workItem: item, weight: body.weight, items: body.items });
  if (error) throw new ApiError(400, error);

  const before = currentBreakdown(entries, item);
  const beforeByName = new Map(before.map((b) => [b.name.toLowerCase(), b]));
  const currentPct = computeWorkItemStatuses(entries).find((s) => s.workItem === item)?.pctComplete ?? 0;
  const lastColor = [...entries].filter((e) => e.workItem?.trim() === item).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]?.color ?? null;
  const color = body.color || lastColor || null;
  const now = new Date();
  const common = { breakdown: true, projectId: body.projectId, submittedById: user.id, workItem: item, weight: body.weight, color, reviewStatus: "APPROVED" as const, reviewedById: user.id, reviewedAt: now, createdAt: now };

  const nextNames = new Set(body.items.map((i) => i.name.toLowerCase()));
  const removed = before.filter((b) => !nextNames.has(b.name.toLowerCase()));

  await prisma.$transaction(async (db) => {
    for (const it of body.items) {
      const was = beforeByName.get(it.name.toLowerCase());
      const pct = it.pctComplete ?? was?.pctComplete ?? currentPct;
      await db.progressEntry.create({ data: { ...common, subItem: was?.name ?? it.name, subWeight: it.weight, pctComplete: pct, notes: was ? "Sub-items updated" : "Sub-item added" } });
    }
    for (const r of removed) await db.progressEntry.create({ data: { ...common, subItem: r.name, subWeight: 0, pctComplete: 0, notes: "Sub-item removed" } });
    if (body.items.length === 0 && before.length > 0) {
      // no sub-items any more: the item is reported as a whole again, starting from where its sub-items had got to
      await db.progressEntry.create({ data: { ...common, subItem: null, subWeight: null, pctComplete: currentPct, notes: "Sub-items taken away — reported as a whole again" } });
    }
  });

  await audit({
    entityType: "Project",
    entityId: project.id,
    actorId: user.id,
    actorName: user.name,
    action: "PROGRESS_SUBITEMS_SET",
    diff: {
      project: project.name,
      workItem: item,
      weight: { from: known, to: body.weight },
      subItems: body.items.map((i) => `${i.name} ${i.weight}%`),
      removed: removed.map((r) => r.name),
    },
  });
  return NextResponse.json({ ok: true });
});
