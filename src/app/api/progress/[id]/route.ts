import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
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
 * PATCH /api/progress/[id] — correct a mistaken progress entry (typo'd %,
 * wrong weight, wrong work item name/color) instead of creating a new one.
 * Editable by the original submitter, or PM/Owner. Photos and the original
 * timestamp are left as-is; editedById/editedAt record the correction.
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

    const canEdit = ["OWNER", "PM"].includes(user.role) || entry.submittedById === user.id;
    if (!canEdit) throw new ApiError(403, "Not authorized to edit this entry");

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
      },
    });

    await audit({
      entityType: "ProgressEntry",
      entityId: entry.id,
      actorId: user.id,
      actorName: user.name,
      action: "PROGRESS_EDITED",
      diff: {
        project: entry.project.name,
        from: { workItem: entry.workItem, weight: entry.weight, pctComplete: Number(entry.pctComplete) },
        to: { workItem: body.workItem || null, weight: body.weight ?? null, pctComplete: body.pctComplete },
      },
    });

    return NextResponse.json(updated);
  }
);
