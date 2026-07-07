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
});

/**
 * POST /api/instructions — Jacob/PM posts a dated, project-specific
 * instruction (Spec 6.6). Lands on the foreman's running daily list.
 */
export const POST = handleApi(async (req: NextRequest) => {
  const user = await requireUser(["OWNER", "PM"]);
  const body = createSchema.parse(await req.json());

  const project = await prisma.project.findUnique({ where: { id: body.projectId } });
  if (!project) throw new ApiError(404, "Project not found");

  const photoUrls = await savePhotos(body.photos);
  const instruction = await prisma.siteInstruction.create({
    data: {
      projectId: body.projectId,
      postedById: user.id,
      text: body.text,
      photoUrl: photoUrls[0] ?? null,
    },
  });

  await audit({
    entityType: "SiteInstruction",
    entityId: instruction.id,
    actorId: user.id,
    actorName: user.name,
    action: "INSTRUCTION_POSTED",
    diff: { project: project.name },
  });
  await notify({
    to: { name: "Site team" },
    subject: `New site instruction — ${project.name}`,
    message: body.text.slice(0, 120),
  });

  return NextResponse.json(instruction, { status: 201 });
});
