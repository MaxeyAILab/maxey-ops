import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { fileSourceSchema, resolveFileSource } from "@/lib/document-input";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";

const createSchema = fileSourceSchema.extend({
  projectId: z.string().min(1),
  title: z.string().trim().min(3).max(200),
  docNo: z.string().trim().max(60).optional().nullable(),
  category: z.enum(["DRAWING", "SPECIFICATION", "PERMIT", "CONTRACT", "REPORT", "OTHER"]).default("OTHER"),
  visibleToClient: z.boolean().optional().default(false),
  revision: z.string().trim().min(1).max(40).default("A"),
  notes: z.string().max(1000).optional().nullable(),
});

/** POST /api/documents — Owner/PM register a document with its first revision. Clients see it only if shared. */
export const POST = handleApi(async (req: NextRequest) => {
  const user = await requireUser(["OWNER", "PM"]);
  const body = createSchema.parse(await req.json());
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
