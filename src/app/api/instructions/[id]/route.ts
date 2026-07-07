import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";

const patchSchema = z.object({
  status: z.enum(["ACKNOWLEDGED", "IN_PROGRESS", "DONE"]),
});

const forwardOrder = ["OPEN", "ACKNOWLEDGED", "IN_PROGRESS", "DONE"];

/**
 * PATCH /api/instructions/[id] — site staff moves an instruction forward
 * (Open → Acknowledged → In Progress → Done, Spec 6.6). Offline-capable:
 * replays of an already-applied transition return 409 (treated as synced),
 * and status never moves backwards so late syncs can't undo progress.
 */
export const PATCH = handleApi(
  async (req: NextRequest, { params }: { params: { id: string } }) => {
    const user = await requireUser(["FOREMAN", "PM", "OWNER"]);
    const body = patchSchema.parse(await req.json());

    const instruction = await prisma.siteInstruction.findUnique({
      where: { id: params.id },
      include: { project: { select: { name: true } } },
    });
    if (!instruction) throw new ApiError(404, "Instruction not found");

    if (forwardOrder.indexOf(body.status) <= forwardOrder.indexOf(instruction.status)) {
      return NextResponse.json({ error: "Already applied" }, { status: 409 });
    }

    const updated = await prisma.siteInstruction.update({
      where: { id: params.id },
      data: { status: body.status },
    });

    await audit({
      entityType: "SiteInstruction",
      entityId: instruction.id,
      actorId: user.id,
      actorName: user.name,
      action: `INSTRUCTION_${body.status}`,
      diff: { project: instruction.project.name, from: instruction.status },
    });

    return NextResponse.json(updated);
  }
);
