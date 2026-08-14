import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { savePhotos } from "@/lib/storage";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";

const createSchema = z.object({
  projectId: z.string().min(1),
  text: z.string().min(1).max(5000),
  photos: z.array(z.string()).max(2).optional(),
  assignedToId: z.string().optional().or(z.literal("")), // blank = broadcast to the whole site team
  dueDate: z.coerce.date().optional(),
});

/**
 * POST /api/instructions — Jacob/PM posts a dated, project-specific
 * instruction (Spec 6.6), optionally assigned to one person with a target
 * completion date. Lands on the foreman's running daily list.
 */
export const POST = handleApi(async (req: NextRequest) => {
  const user = await requireUser(["OWNER", "PM"]);
  const body = createSchema.parse(await req.json());

  const project = await prisma.project.findUnique({ where: { id: body.projectId } });
  if (!project) throw new ApiError(404, "Project not found");

  let assignee = null;
  if (body.assignedToId) {
    assignee = await prisma.user.findUnique({ where: { id: body.assignedToId } });
    if (!assignee || !assignee.active) throw new ApiError(400, "Unknown or inactive assignee");
  }

  const photoUrls = await savePhotos(body.photos);
  const instruction = await prisma.siteInstruction.create({
    data: {
      projectId: body.projectId,
      postedById: user.id,
      assignedToId: assignee?.id ?? null,
      text: body.text,
      photoUrl: photoUrls[0] ?? null,
      dueDate: body.dueDate ?? null,
    },
  });

  await audit({
    entityType: "SiteInstruction",
    entityId: instruction.id,
    actorId: user.id,
    actorName: user.name,
    action: "INSTRUCTION_POSTED",
    diff: { project: project.name, assignedTo: assignee?.name ?? null, dueDate: body.dueDate ?? null },
  });
  await notify({
    to: { name: assignee?.name ?? "Site team" },
    subject: `New site instruction — ${project.name}`,
    message: body.text.slice(0, 120),
  });

  return NextResponse.json(instruction, { status: 201 });
});
