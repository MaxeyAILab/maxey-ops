import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { savePhotos } from "@/lib/storage";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import { instructionProjectOrCategoryLabel } from "@/lib/instructions";

const createSchema = z.object({
  projectId: z.string().min(1).optional().or(z.literal("")), // omitted/empty for non-project instructions
  category: z.enum(["OFFICE", "SITE", "DELIVERIES", "WAREHOUSE", "OTHER"]).optional(), // only meaningful when projectId is empty
  text: z.string().min(1).max(5000),
  photos: z.array(z.string()).max(2).optional(),
  assignedToId: z.string().optional().or(z.literal("")), // blank = broadcast to the whole site team
  dueDate: z.coerce.date().optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "CRITICAL"]).default("NORMAL"),
});

/**
 * POST /api/instructions — Jacob/PM posts a dated instruction (Spec 6.6),
 * against a project or a category (office/site/deliveries/warehouse/other)
 * when there's no active project to attach it to. Optionally assigned to one
 * person with a target completion date. Lands on the foreman's daily list.
 */
export const POST = handleApi(async (req: NextRequest) => {
  const user = await requireUser(["OWNER", "PM"]);
  const body = createSchema.parse(await req.json());

  const project = body.projectId
    ? await prisma.project.findUnique({ where: { id: body.projectId } })
    : null;
  if (body.projectId && !project) throw new ApiError(404, "Project not found");
  const category = body.projectId ? null : body.category ?? "OTHER";
  const label = instructionProjectOrCategoryLabel({ project, category });

  let assignee = null;
  if (body.assignedToId) {
    assignee = await prisma.user.findUnique({ where: { id: body.assignedToId } });
    if (!assignee || !assignee.active) throw new ApiError(400, "Unknown or inactive assignee");
  }

  const photoUrls = await savePhotos(body.photos);
  const instruction = await prisma.siteInstruction.create({
    data: {
      projectId: body.projectId || null,
      category,
      postedById: user.id,
      assignedToId: assignee?.id ?? null,
      text: body.text,
      photoUrl: photoUrls[0] ?? null,
      dueDate: body.dueDate ?? null,
      priority: body.priority,
    },
  });

  await audit({
    entityType: "SiteInstruction",
    entityId: instruction.id,
    actorId: user.id,
    actorName: user.name,
    action: "INSTRUCTION_POSTED",
    diff: {
      project: label,
      assignedTo: assignee?.name ?? null,
      dueDate: body.dueDate ?? null,
      priority: body.priority,
    },
  });
  await notify({
    to: { name: assignee?.name ?? "Site team" },
    subject: `New site instruction — ${label}`,
    message: body.text.slice(0, 120),
  });

  return NextResponse.json(instruction, { status: 201 });
});
