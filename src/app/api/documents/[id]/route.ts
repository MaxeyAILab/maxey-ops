import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";

const patchSchema = z.object({
  title: z.string().trim().min(3).max(200).optional(),
  docNo: z.string().trim().max(60).optional().nullable(),
  category: z.enum(["DRAWING", "SPECIFICATION", "PERMIT", "CONTRACT", "REPORT", "OTHER"]).optional(),
  visibleToClient: z.boolean().optional(),
});

/** PATCH /api/documents/[id] — Owner/PM rename a document or change whether the client can see it. */
export const PATCH = handleApi(async (req: NextRequest, { params }: { params: { id: string } }) => {
  const user = await requireUser(["OWNER", "PM"]);
  const body = patchSchema.parse(await req.json());
  const doc = await prisma.projectDocument.findUnique({ where: { id: params.id }, include: { project: { select: { name: true } } } });
  if (!doc) throw new ApiError(404, "Document not found");
  await prisma.projectDocument.update({
    where: { id: doc.id },
    data: {
      ...(body.title ? { title: body.title } : {}),
      ...(body.docNo !== undefined ? { docNo: body.docNo || null } : {}),
      ...(body.category ? { category: body.category } : {}),
      ...(body.visibleToClient !== undefined ? { visibleToClient: body.visibleToClient } : {}),
    },
  });
  await audit({
    entityType: "ProjectDocument",
    entityId: doc.id,
    actorId: user.id,
    actorName: user.name,
    action: body.visibleToClient !== undefined && body.visibleToClient !== doc.visibleToClient ? (body.visibleToClient ? "DOCUMENT_SHARED_WITH_CLIENT" : "DOCUMENT_UNSHARED") : "DOCUMENT_UPDATED",
    diff: { project: doc.project.name, title: body.title ?? doc.title, shared: body.visibleToClient ?? doc.visibleToClient },
  });
  return NextResponse.json({ ok: true });
});

/** DELETE /api/documents/[id] — Owner only. The audit entry records what was removed; stored files are kept in the bucket. */
export const DELETE = handleApi(async (_req: NextRequest, { params }: { params: { id: string } }) => {
  const user = await requireUser(["OWNER"]);
  const doc = await prisma.projectDocument.findUnique({ where: { id: params.id }, include: { project: { select: { name: true } }, revisions: { select: { revision: true } } } });
  if (!doc) throw new ApiError(404, "Document not found");
  await prisma.projectDocument.delete({ where: { id: doc.id } });
  await audit({
    entityType: "ProjectDocument",
    entityId: doc.id,
    actorId: user.id,
    actorName: user.name,
    action: "DOCUMENT_DELETED",
    diff: { project: doc.project.name, title: doc.title, revisions: doc.revisions.map((r) => r.revision).join(", ") },
  });
  return NextResponse.json({ ok: true });
});
