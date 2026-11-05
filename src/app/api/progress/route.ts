import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { savePhotos } from "@/lib/storage";
import { checkWeightRules, currentBreakdown, currentWeight } from "@/lib/progress";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import { canInputProgress } from "@/lib/project-input";

const createSchema = z.object({
  clientUuid: z.string().uuid(),
  submittedAt: z.coerce.date(),
  projectId: z.string().min(1),
  workItem: z.string().max(200).optional().or(z.literal("")),
  /** which sub-item of the work item this reports (required when the work item has been broken into sub-items) */
  subItem: z.string().max(200).optional().or(z.literal("")),
  weight: z.coerce.number().min(0).max(100).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional()
    .or(z.literal("")),
  pctComplete: z.coerce.number().min(0).max(100),
  notes: z.string().max(5000).optional().or(z.literal("")),
  photos: z.array(z.string()).max(6).optional(), // compressed data URLs (Spec §4)
});

/**
 * POST /api/progress — daily progress entry (PM/foreman, offline-capable).
 * Feeds the owner dashboard and the client portal timeline (Spec 6.7).
 */
export const POST = handleApi(async (req: NextRequest) => {
  const user = await requireUser();
  if (!canInputProgress(user)) throw new ApiError(403, "Not authorized for this action");
  const body = createSchema.parse(await req.json());

  const existing = await prisma.progressEntry.findUnique({
    where: { clientUuid: body.clientUuid },
  });
  if (existing) {
    return NextResponse.json({ error: "Already synced", id: existing.id }, { status: 409 });
  }

  const project = await prisma.project.findUnique({ where: { id: body.projectId } });
  if (!project) throw new ApiError(400, "Unknown project");

  // PM/Owner entries are their own approval; a foreman's entry waits for review.
  const isApprover = user.role === "OWNER" || user.role === "PM";

  const projectEntries = await prisma.progressEntry.findMany({
    where: { projectId: body.projectId },
    select: { id: true, workItem: true, weight: true, createdAt: true, reviewStatus: true, subItem: true, subWeight: true, pctComplete: true, color: true },
  });

  // A work item broken into sub-items is reported one sub-item at a time; its weights and color are the breakdown's, not the form's.
  const workItem = body.workItem?.trim() || null;
  const subName = body.subItem?.trim() || null;
  const subs = workItem ? currentBreakdown(projectEntries, workItem) : [];
  let weight = body.weight ?? null;
  let color = body.color || null;
  let subWeight: number | null = null;
  if (subs.length > 0) {
    if (!subName) throw new ApiError(400, `"${workItem}" is broken into sub-items — choose which sub-item you are reporting.`);
    const sub = subs.find((s) => s.name.toLowerCase() === subName.toLowerCase());
    if (!sub) throw new ApiError(400, `"${subName}" is not a sub-item of "${workItem}".`);
    weight = currentWeight(projectEntries, workItem!);
    subWeight = sub.weight;
    color = [...projectEntries].filter((e) => e.workItem?.trim() === workItem).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]?.color ?? color;
  } else {
    if (subName) throw new ApiError(400, `"${workItem ?? "This work item"}" has no sub-items yet — the PM or Owner sets them up first.`);
    // a report with no weight on a work item that already has one carries that weight, so it is never silently left out of the total
    if (weight == null && workItem) weight = currentWeight(projectEntries, workItem);
    const weightError = checkWeightRules(projectEntries, { workItem, weight }, isApprover);
    if (weightError) throw new ApiError(400, weightError);
  }

  const photoUrls = await savePhotos(body.photos);
  const entry = await prisma.progressEntry.create({
    data: {
      clientUuid: body.clientUuid,
      projectId: body.projectId,
      submittedById: user.id,
      workItem,
      weight,
      color,
      subItem: subs.length > 0 ? subs.find((s) => s.name.toLowerCase() === subName!.toLowerCase())!.name : null,
      subWeight,
      pctComplete: body.pctComplete,
      notes: body.notes || null,
      photos: photoUrls.length ? photoUrls : undefined,
      createdAt: body.submittedAt,
      reviewStatus: isApprover ? "APPROVED" : "SUBMITTED",
      reviewedById: isApprover ? user.id : null,
      reviewedAt: isApprover ? new Date() : null,
    },
  });

  await audit({
    entityType: "ProgressEntry",
    entityId: entry.id,
    actorId: user.id,
    actorName: user.name,
    action: "PROGRESS_REPORTED",
    diff: {
      project: project.name,
      pctComplete: body.pctComplete,
      workItem,
      subItem: entry.subItem,
      weight,
      status: entry.reviewStatus,
      autoApproved: isApprover,
    },
  });

  return NextResponse.json(entry, { status: 201 });
});
