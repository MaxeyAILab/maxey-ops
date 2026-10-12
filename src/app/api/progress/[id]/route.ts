import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { checkWeightRules } from "@/lib/progress";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";

const patchSchema = z.object({
  workItem: z.string().max(200).optional().or(z.literal("")),
  weight: z.coerce.number().min(0).max(100).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional()
    .or(z.literal("")),
  pctComplete: z.coerce.number().min(0).max(100),
  notes: z.string().max(5000).optional().or(z.literal("")),
});

/**
 * PATCH /api/progress/[id] — correct a mistaken progress entry instead of
 * creating a new one.
 *  - SUBMITTED: the submitter or a PM/Owner may edit; it stays SUBMITTED.
 *  - QUERIED: the submitter's edit resubmits it for review (a PM/Owner edit
 *    leaves it queried).
 *  - APPROVED: only a PM/Owner may change it, and it is recorded as a
 *    correction with before/after values — an approved measurement is never
 *    silently overwritten.
 * Photos and the original timestamp are left as-is.
 */
export const PATCH = handleApi(
  async (req: NextRequest, { params }: { params: { id: string } }) => {
    const user = await requireUser(["OWNER", "PM", "FOREMAN"]);
    const body = patchSchema.parse(await req.json());

    const entry = await prisma.progressEntry.findUnique({
      where: { id: params.id },
      include: { project: { select: { name: true } } },
    });
    if (!entry) throw new ApiError(404, "Progress entry not found");

    const isApprover = ["OWNER", "PM"].includes(user.role);
    const isSubmitter = entry.submittedById === user.id;
    if (!isApprover && !isSubmitter) throw new ApiError(403, "Not authorized to edit this entry");
    if (entry.reviewStatus === "APPROVED" && !isApprover) {
      throw new ApiError(403, "Approved entries can only be corrected by the PM or Owner");
    }

    const projectEntries = await prisma.progressEntry.findMany({
      where: { projectId: entry.projectId },
      select: { id: true, workItem: true, weight: true, createdAt: true, reviewStatus: true },
    });
    const weightError = checkWeightRules(
      projectEntries,
      { workItem: body.workItem || null, weight: body.weight ?? null, excludeId: entry.id },
      isApprover
    );
    if (weightError) throw new ApiError(400, weightError);

    const resubmitting = entry.reviewStatus === "QUERIED" && isSubmitter && !isApprover;
    const correcting = entry.reviewStatus === "APPROVED";

    const updated = await prisma.progressEntry.update({
      where: { id: params.id },
      data: {
        workItem: body.workItem || null,
        weight: body.weight ?? null,
        color: body.color || null,
        pctComplete: body.pctComplete,
        notes: body.notes || null,
        editedById: user.id,
        editedAt: new Date(),
        ...(resubmitting ? { reviewStatus: "SUBMITTED" as const } : {}),
        ...(correcting ? { reviewedById: user.id, reviewedAt: new Date() } : {}),
      },
    });

    await audit({
      entityType: "ProgressEntry",
      entityId: entry.id,
      actorId: user.id,
      actorName: user.name,
      action: correcting ? "PROGRESS_CORRECTED" : resubmitting ? "PROGRESS_RESUBMITTED" : "PROGRESS_EDITED",
      diff: {
        project: entry.project.name,
        status: updated.reviewStatus,
        from: { workItem: entry.workItem, weight: entry.weight?.toString() ?? null, pctComplete: Number(entry.pctComplete) },
        to: { workItem: body.workItem || null, weight: body.weight ?? null, pctComplete: body.pctComplete },
      },
    });

    return NextResponse.json(updated);
  }
);
