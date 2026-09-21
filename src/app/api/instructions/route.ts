import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { savePhotos } from "@/lib/storage";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import { instructionProjectOrCategoryLabel, taskIdPrefix } from "@/lib/instructions";

const createSchema = z.object({
  projectId: z.string().min(1).optional().or(z.literal("")), // omitted/empty for non-project instructions
  category: z.enum(["OFFICE", "SITE", "DELIVERIES", "WAREHOUSE", "OTHER"]).optional(), // only meaningful when projectId is empty
  title: z.string().min(1).max(200),
  text: z.string().min(1).max(5000),
  photos: z.array(z.string()).max(2).optional(),
  assigneeIds: z.array(z.string()).max(50).optional().default([]), // empty = broadcast to the whole site team
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

  let assignees: { id: string; name: string }[] = [];
  if (body.assigneeIds.length > 0) {
    assignees = await prisma.user.findMany({
      where: { id: { in: body.assigneeIds }, active: true },
      select: { id: true, name: true },
    });
    if (assignees.length !== body.assigneeIds.length) {
      throw new ApiError(400, "Unknown or inactive assignee");
    }
  }

  // Task ID assigned once, at creation, and never changed afterward — a
  // real project's own code, else DOT for deliveries or OOT for everything
  // else non-project (Spec: office/general-site/warehouse/other).
  const prefix = taskIdPrefix(project?.code, category);
  const year = new Date().getFullYear();
  const seqCount = await prisma.siteInstruction.count({
    where: { taskId: { startsWith: `${prefix}-${year}-` } },
  });
  const taskId = `${prefix}-${year}-${String(seqCount + 1).padStart(4, "0")}`;

  const photoUrls = await savePhotos(body.photos);
  const instruction = await prisma.siteInstruction.create({
    data: {
      taskId,
      title: body.title,
      projectId: body.projectId || null,
      category,
      postedById: user.id,
      assignees: { connect: assignees.map((a) => ({ id: a.id })) },
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
      taskId,
      title: body.title,
      project: label,
      assignedTo: assignees.length > 0 ? assignees.map((a) => a.name).join(", ") : null,
      dueDate: body.dueDate ?? null,
      priority: body.priority,
    },
  });
  await notify({
    to: { name: assignees.length > 0 ? assignees.map((a) => a.name).join(", ") : "Site team" },
    subject: `New site instruction — ${label} (${taskId})`,
    message: `${body.title}: ${body.text.slice(0, 120)}`,
  });

  return NextResponse.json(instruction, { status: 201 });
});
