import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { fileSourceSchema, resolveFileSource } from "@/lib/document-input";
import { nextRevisionLabel } from "@/lib/documents";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";

const schema = fileSourceSchema.extend({
  revision: z.string().trim().min(1).max(40).optional(),
  notes: z.string().max(1000).optional().nullable(),
});

/**
 * POST /api/documents/[id]/revisions — Owner/PM issue a new revision. The previous current
 * revision becomes "superseded" and stays on record; nothing is overwritten. The document row
 * is locked for the duration so two simultaneous uploads can't both end up "current".
 */
export const POST = handleApi(async (req: NextRequest, { params }: { params: { id: string } }) => {
  const user = await requireUser(["OWNER", "PM"]);
  const body = schema.parse(await req.json());
  const doc = await prisma.projectDocument.findUnique({
    where: { id: params.id },
    include: { project: { select: { name: true } }, revisions: { select: { revision: true } } },
  });
  if (!doc) throw new ApiError(404, "Document not found");
  const file = await resolveFileSource(body);
  const label = body.revision || nextRevisionLabel(doc.revisions.map((r) => r.revision));

  try {
    await prisma.$transaction(async (db) => {
      await db.$queryRaw`SELECT id FROM "ProjectDocument" WHERE id = ${doc.id} FOR UPDATE`;
      await db.documentRevision.updateMany({ where: { documentId: doc.id, current: true }, data: { current: false, supersededAt: new Date() } });
      await db.documentRevision.create({
        data: {
          documentId: doc.id,
          revision: label,
          url: file.url,
          isExternal: file.isExternal,
          fileName: file.fileName,
          notes: body.notes || null,
          uploadedById: user.id,
          uploadedByName: user.name,
        },
      });
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new ApiError(409, `Revision “${label}” already exists for this document — pick a different label`);
    }
    throw err;
  }

  await audit({
    entityType: "ProjectDocument",
    entityId: doc.id,
    actorId: user.id,
    actorName: user.name,
    action: "DOCUMENT_REVISION_ADDED",
    diff: { project: doc.project.name, title: doc.title, revision: label, previous: doc.revisions.map((r) => r.revision).join(", ") },
  });
  return NextResponse.json({ ok: true, revision: label }, { status: 201 });
});
