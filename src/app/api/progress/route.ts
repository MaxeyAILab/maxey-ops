import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { savePhotos } from "@/lib/storage";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";

const createSchema = z.object({
  clientUuid: z.string().uuid(),
  submittedAt: z.coerce.date(),
  projectId: z.string().min(1),
  workItem: z.string().max(200).optional().or(z.literal("")),
  pctComplete: z.coerce.number().min(0).max(100),
  notes: z.string().max(5000).optional().or(z.literal("")),
  photos: z.array(z.string()).max(6).optional(), // compressed data URLs (Spec §4)
});

/**
 * POST /api/progress — daily progress entry (PM/foreman, offline-capable).
 * Feeds the owner dashboard and the client portal timeline (Spec 6.7).
 */
export const POST = handleApi(async (req: NextRequest) => {
  const user = await requireUser(["PM", "FOREMAN", "OWNER"]);
  const body = createSchema.parse(await req.json());

  const existing = await prisma.progressEntry.findUnique({
    where: { clientUuid: body.clientUuid },
  });
  if (existing) {
    return NextResponse.json({ error: "Already synced", id: existing.id }, { status: 409 });
  }

  const project = await prisma.project.findUnique({ where: { id: body.projectId } });
  if (!project) throw new ApiError(400, "Unknown project");

  const photoUrls = await savePhotos(body.photos);
  const entry = await prisma.progressEntry.create({
    data: {
      clientUuid: body.clientUuid,
      projectId: body.projectId,
      submittedById: user.id,
      workItem: body.workItem || null,
      pctComplete: body.pctComplete,
      notes: body.notes || null,
      photos: photoUrls.length ? photoUrls : undefined,
      createdAt: body.submittedAt,
    },
  });

  await audit({
    entityType: "ProgressEntry",
    entityId: entry.id,
    actorId: user.id,
    actorName: user.name,
    action: "PROGRESS_REPORTED",
    diff: { project: project.name, pctComplete: body.pctComplete, workItem: body.workItem ?? null },
  });

  return NextResponse.json(entry, { status: 201 });
});
