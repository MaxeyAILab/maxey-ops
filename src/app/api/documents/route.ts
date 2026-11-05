import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { fileSourceSchema, resolveFileSource } from "@/lib/document-input";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import { canAddDocument, isProjectManagerRole } from "@/lib/project-input";

const createSchema = fileSourceSchema.extend({
  projectId: z.string().min(1),
  title: z.string().trim().min(3).max(200),
  docNo: z.string().trim().max(60).optional().nullable(),
  category: z.enum(["DRAWING", "SPECIFICATION", "PERMIT", "CONTRACT", "REPORT", "OTHER"]).default("OTHER"),
  visibleToClient: z.boolean().optional().default(false),
  revision: z.string().trim().min(1).max(40).default("A"),
  notes: z.string().max(1000).optional().nullable(),
});

/** POST /api/documents — Owner/PM (and anyone given project input, internal only) register a document with its first revision. Clients see it only if shared. */
export const POST = handleApi(async (req: NextRequest) => {
  const user = await requireUser();
  if (!canAddDocument(user)) throw new ApiError(403, "Not authorized for this action");
  const body = createSchema.parse(await req.json());
  // sharing with the client stays with the Owner/PM: anyone else adds the document for the team only
  if (!isProjectManagerRole(user)) body.visibleToClient = false;
  const project = await prisma.project.findUnique({ where: { id: body.projectId }, select: { id: true, name: true } });
  if (!project) throw new ApiError(404, "Project not found");
  const file = await resolveFileSource(body);

  const doc = await prisma.projectDocument.create({
    data: {
      projectId: project.id,
      title: body.title,
      docNo: body.docNo || null,
      category: body.category,
      visibleToClient: body.visibleToClient,
      createdById: user.id,
      revisions: {
        create: {
          revision: body.revision,
          url: file.url,
          isExternal: file.isExternal,
          fileName: file.fileName,
          notes: body.notes || null,
          uploadedById: user.id,
          uploadedByName: user.name,
        },
      },
    },
  });
  await audit({
    entityType: "ProjectDocument",
    entityId: doc.id,
    actorId: user.id,
    actorName: user.name,
    action: "DOCUMENT_ADDED",
    diff: { project: project.name, title: body.title, docNo: body.docNo ?? null, revision: body.revision, shared: body.visibleToClient },
  });
  return NextResponse.json({ id: doc.id }, { status: 201 });
});
