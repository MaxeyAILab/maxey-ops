import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import { instructionProjectOrCategoryLabel } from "@/lib/instructions";

const patchSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("update_status"),
    status: z.enum(["NOT_STARTED", "IN_PROGRESS", "ON_HOLD", "FOR_REVIEW", "COMPLETED", "CANCELLED"]),
    // Omit entirely to leave remarks untouched (the compact board cell does
    // this); send "" to explicitly clear, or text to update (the full
    // update form always sends this field).
    remarks: z.string().max(2000).optional(),
  }),
  z.object({
    action: z.literal("review"),
    approval: z.enum(["APPROVED", "NEEDS_REVISION"]),
    supervisorRemarks: z.string().max(2000).optional().or(z.literal("")),
  }),
  z.object({
    action: z.literal("set_priority"),
    priority: z.enum(["LOW", "NORMAL", "HIGH", "CRITICAL"]),
  }),
  z.object({
    action: z.literal("edit"),
    text: z.string().min(1).max(5000),
    projectId: z.string().optional().or(z.literal("")),
    category: z.enum(["OFFICE", "SITE", "DELIVERIES", "WAREHOUSE", "OTHER"]).optional(),
    assignedToId: z.string().optional().or(z.literal("")),
    dueDate: z.coerce.date().optional().nullable(),
  }),
]);

/**
 * PATCH /api/instructions/[id] — three independent actions on an assignment:
 *  - update_status: the assignee (or PM/Owner, or Foreman for unassigned
 *    broadcast instructions) sets status, optionally with a progress remark.
 *    Actual completion date is stamped/cleared automatically as status
 *    crosses into/out of COMPLETED.
 *  - review: Owner/PM leaves supervisor remarks and an approval verdict —
 *    independent of status, doesn't gate it.
 *  - set_priority: Owner/PM only.
 */
export const PATCH = handleApi(
  async (req: NextRequest, { params }: { params: { id: string } }) => {
    const user = await requireUser();
    if (user.role === "CLIENT") throw new ApiError(403, "Not authorized");
    const body = patchSchema.parse(await req.json());

    const instruction = await prisma.siteInstruction.findUnique({
      where: { id: params.id },
      include: { project: { select: { name: true } } },
    });
    if (!instruction) throw new ApiError(404, "Instruction not found");

    if (body.action === "review") {
      if (!["OWNER", "PM"].includes(user.role)) throw new ApiError(403, "Only Owner/PM can review");

      const updated = await prisma.siteInstruction.update({
        where: { id: params.id },
        data: {
          approval: body.approval,
          supervisorRemarks: body.supervisorRemarks || null,
        },
      });

      await audit({
        entityType: "SiteInstruction",
        entityId: instruction.id,
        actorId: user.id,
        actorName: user.name,
        action: "INSTRUCTION_REVIEWED",
        diff: { project: instructionProjectOrCategoryLabel(instruction), approval: body.approval },
      });

      return NextResponse.json(updated);
    }

    if (body.action === "edit") {
      if (!["OWNER", "PM"].includes(user.role)) throw new ApiError(403, "Only Owner/PM can edit an assignment");

      const project = body.projectId
        ? await prisma.project.findUnique({ where: { id: body.projectId } })
        : null;
      if (body.projectId && !project) throw new ApiError(404, "Project not found");
      const category = body.projectId ? null : body.category ?? "OTHER";

      let assignee = null;
      if (body.assignedToId) {
        assignee = await prisma.user.findUnique({ where: { id: body.assignedToId } });
        if (!assignee || !assignee.active) throw new ApiError(400, "Unknown or inactive assignee");
      }

      const updated = await prisma.siteInstruction.update({
        where: { id: params.id },
        data: {
          text: body.text,
          projectId: body.projectId || null,
          category,
          assignedToId: assignee?.id ?? null,
          dueDate: body.dueDate ?? null,
        },
      });

      await audit({
        entityType: "SiteInstruction",
        entityId: instruction.id,
        actorId: user.id,
        actorName: user.name,
        action: "INSTRUCTION_EDITED",
        diff: {
          from: { text: instruction.text, project: instructionProjectOrCategoryLabel(instruction) },
          to: { text: body.text, project: instructionProjectOrCategoryLabel({ project, category }) },
        },
      });

      return NextResponse.json(updated);
    }

    if (body.action === "set_priority") {
      if (!["OWNER", "PM"].includes(user.role)) throw new ApiError(403, "Only Owner/PM can set priority");

      const updated = await prisma.siteInstruction.update({
        where: { id: params.id },
        data: { priority: body.priority },
      });

      await audit({
        entityType: "SiteInstruction",
        entityId: instruction.id,
        actorId: user.id,
        actorName: user.name,
        action: "INSTRUCTION_PRIORITY_SET",
        diff: {
          project: instructionProjectOrCategoryLabel(instruction),
          from: instruction.priority,
          to: body.priority,
        },
      });

      return NextResponse.json(updated);
    }

    const canUpdate =
      ["OWNER", "PM"].includes(user.role) ||
      instruction.assignedToId === user.id ||
      (!instruction.assignedToId && user.role === "FOREMAN");
    if (!canUpdate) throw new ApiError(403, "Not authorized to update this assignment");

    const updated = await prisma.siteInstruction.update({
      where: { id: params.id },
      data: {
        status: body.status,
        ...(body.remarks !== undefined ? { remarks: body.remarks || null } : {}),
        completedAt: body.status === "COMPLETED" ? (instruction.completedAt ?? new Date()) : null,
      },
    });

    await audit({
      entityType: "SiteInstruction",
      entityId: instruction.id,
      actorId: user.id,
      actorName: user.name,
      action: `INSTRUCTION_${body.status}`,
      diff: {
        project: instructionProjectOrCategoryLabel(instruction),
        from: instruction.status,
        remarks: body.remarks !== undefined ? body.remarks || null : undefined,
      },
    });

    return NextResponse.json(updated);
  }
);

/** DELETE /api/instructions/[id] — Owner-only cleanup for a test/mistaken assignment. */
export const DELETE = handleApi(
  async (_req: NextRequest, { params }: { params: { id: string } }) => {
    const user = await requireUser(["OWNER"]);

    const instruction = await prisma.siteInstruction.findUnique({
      where: { id: params.id },
      include: { project: { select: { name: true } } },
    });
    if (!instruction) throw new ApiError(404, "Instruction not found");

    await prisma.siteInstruction.delete({ where: { id: params.id } });

    await audit({
      entityType: "SiteInstruction",
      entityId: instruction.id,
      actorId: user.id,
      actorName: user.name,
      action: "INSTRUCTION_DELETED",
      diff: { text: instruction.text, project: instructionProjectOrCategoryLabel(instruction) },
    });

    return NextResponse.json({ ok: true });
  }
);
