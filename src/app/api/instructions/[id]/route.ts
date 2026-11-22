import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import { instructionProjectOrCategoryLabel } from "@/lib/instructions";
import { notifyPeople } from "@/lib/notify-people";
import { manilaDayKey } from "@/lib/time-rules";
import { canAskExtension, extensionProblem, shortDay } from "@/lib/instruction-due";

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
  // extension of the target date (owner's request 2026-11-22)
  z.object({ action: z.literal("request_extension"), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reason: z.string().max(1000) }),
  z.object({ action: z.literal("decide_extension"), decision: z.enum(["approve", "reject"]), note: z.string().max(1000).optional().or(z.literal("")) }),
  z.object({ action: z.literal("cancel_extension") }),
  z.object({
    action: z.literal("set_priority"),
    priority: z.enum(["LOW", "NORMAL", "HIGH", "CRITICAL"]),
  }),
  z.object({
    action: z.literal("edit"),
    title: z.string().min(1).max(200),
    text: z.string().min(1).max(5000),
    projectId: z.string().optional().or(z.literal("")),
    category: z.enum(["OFFICE", "SITE", "DELIVERIES", "WAREHOUSE", "OTHER"]).optional(),
    assigneeIds: z.array(z.string()).max(50).optional().default([]), // empty = broadcast
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
      include: { project: { select: { name: true } }, assignees: { select: { id: true } } },
    });
    if (!instruction) throw new ApiError(404, "Instruction not found");

    // ---- extension of the target date: the people doing the task ask, the Owner/PM decide ----
    if (body.action === "request_extension" || body.action === "decide_extension" || body.action === "cancel_extension") {
      const label = instruction.title ?? instruction.text.slice(0, 60);
      const ref = [instruction.taskId, instructionProjectOrCategoryLabel(instruction)].filter(Boolean).join(" · ");
      const url = `/instructions/${instruction.id}`;
      const isBoss = ["OWNER", "PM"].includes(user.role);
      const dueKey = instruction.dueDate ? manilaDayKey(instruction.dueDate) : null;

      if (body.action === "request_extension") {
        const isAssignee = instruction.assignees.some((a) => a.id === user.id);
        if (!canAskExtension({ role: user.role, isAssignee, broadcast: instruction.assignees.length === 0 })) {
          throw new ApiError(403, isBoss ? "As Owner/PM, change the target date with Edit" : "Only the people doing this task can ask for more time");
        }
        const problem = extensionProblem({ status: instruction.status, dueKey, proposedKey: body.dueDate, todayKey: manilaDayKey(new Date()), reason: body.reason, pending: !!instruction.extensionAt });
        if (problem) throw new ApiError(400, problem);
        const done = await prisma.siteInstruction.updateMany({
          where: { id: instruction.id, extensionAt: null },
          data: { extensionDue: new Date(`${body.dueDate}T00:00:00.000Z`), extensionReason: body.reason.trim(), extensionById: user.id, extensionByName: user.name, extensionAt: new Date() },
        });
        if (done.count === 0) throw new ApiError(409, "An extension request is already waiting for the Owner/PM");
        await audit({ entityType: "SiteInstruction", entityId: instruction.id, actorId: user.id, actorName: user.name, action: "INSTRUCTION_EXTENSION_REQUESTED", diff: { task: ref, from: dueKey, to: body.dueDate, reason: body.reason.trim() } });
        const bosses = await prisma.user.findMany({ where: { active: true, role: { in: ["OWNER", "PM"] } }, select: { id: true } });
        await notifyPeople([...bosses.map((b) => b.id), instruction.postedById].filter((id) => id !== user.id), {
          category: "INSTRUCTIONS",
          title: `Extension asked: ${label}`,
          body: `${user.name} asks to move the target from ${dueKey ? shortDay(dueKey) : "—"} to ${shortDay(body.dueDate)} — “${body.reason.trim().slice(0, 120)}”. Tap to approve or reject`,
          url,
          tag: `ins-ext:${instruction.id}`,
        });
        return NextResponse.json({ ok: true });
      }

      if (!instruction.extensionAt || !instruction.extensionDue) throw new ApiError(409, "There is no extension request waiting on this task");
      const askedKey = manilaDayKey(instruction.extensionDue);
      const clear = { extensionDue: null, extensionReason: null, extensionById: null, extensionByName: null, extensionAt: null };

      if (body.action === "cancel_extension") {
        if (instruction.extensionById !== user.id && !isBoss) throw new ApiError(403, "Only the person who asked (or the Owner/PM) can withdraw it");
        await prisma.siteInstruction.updateMany({ where: { id: instruction.id, extensionAt: instruction.extensionAt }, data: clear });
        await audit({ entityType: "SiteInstruction", entityId: instruction.id, actorId: user.id, actorName: user.name, action: "INSTRUCTION_EXTENSION_CANCELLED", diff: { task: ref, asked: askedKey } });
        return NextResponse.json({ ok: true });
      }

      // decide
      if (!isBoss) throw new ApiError(403, "Only the Owner or PM can approve or reject an extension");
      const approve = body.decision === "approve";
      const note = (body.note ?? "").trim();
      const done = await prisma.siteInstruction.updateMany({
        where: { id: instruction.id, extensionAt: instruction.extensionAt },
        data: approve
          ? { ...clear, dueDate: instruction.extensionDue, originalDueDate: instruction.originalDueDate ?? instruction.dueDate, extensionCount: { increment: 1 } }
          : clear,
      });
      if (done.count === 0) throw new ApiError(409, "This request was just changed — reload the page");
      await audit({
        entityType: "SiteInstruction",
        entityId: instruction.id,
        actorId: user.id,
        actorName: user.name,
        action: approve ? "INSTRUCTION_EXTENSION_APPROVED" : "INSTRUCTION_EXTENSION_REJECTED",
        diff: { task: ref, from: dueKey, asked: askedKey, requestedBy: instruction.extensionByName, note: note || null },
      });
      await notifyPeople([instruction.extensionById!, ...instruction.assignees.map((a) => a.id)].filter((id) => id !== user.id), {
        category: "INSTRUCTIONS",
        title: approve ? `Extension approved: ${label}` : `Extension not approved: ${label}`,
        body: approve
          ? `${user.name} moved the target to ${shortDay(askedKey)}.${note ? ` “${note.slice(0, 120)}”` : ""}`
          : `The target stays ${dueKey ? shortDay(dueKey) : "as it was"}.${note ? ` “${note.slice(0, 120)}”` : ""} Please update the task`,
        url,
        tag: `ins-ext:${instruction.id}`,
      });
      return NextResponse.json({ ok: true });
    }

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

      const updated = await prisma.siteInstruction.update({
        where: { id: params.id },
        data: {
          title: body.title,
          text: body.text,
          projectId: body.projectId || null,
          category,
          assignees: { set: assignees.map((a) => ({ id: a.id })) },
          dueDate: body.dueDate ?? null,
          // the Owner/PM set the date themselves → a waiting extension request is settled by it
          ...(instruction.extensionAt && (body.dueDate?.getTime() ?? null) !== (instruction.dueDate?.getTime() ?? null)
            ? { extensionDue: null, extensionReason: null, extensionById: null, extensionByName: null, extensionAt: null }
            : {}),
        },
      });

      await audit({
        entityType: "SiteInstruction",
        entityId: instruction.id,
        actorId: user.id,
        actorName: user.name,
        action: "INSTRUCTION_EDITED",
        diff: {
          from: { title: instruction.title, text: instruction.text, project: instructionProjectOrCategoryLabel(instruction) },
          to: { title: body.title, text: body.text, project: instructionProjectOrCategoryLabel({ project, category }) },
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
      instruction.assignees.some((a) => a.id === user.id) ||
      (instruction.assignees.length === 0 && user.role === "FOREMAN");
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
