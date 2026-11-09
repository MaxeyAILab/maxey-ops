import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import { contractLock } from "@/lib/project-cost";

const patchSchema = z.object({
  contractValue: z.coerce.number().min(0).max(100_000_000_000),
  /** why it is being revised — kept in the audit log */
  reason: z.string().trim().min(3).max(500),
});

/**
 * PATCH /api/projects/[id]/contract-value — Owner only. Revises the project cost (contract value) in any status. Before construction
 * starts this is the normal way; once it has started the value is "final" for everyone else (they use a change order the client
 * approves) but the Owner may still correct it. Every revision is recorded with the old and new value, the reason, and whether
 * construction had already started.
 */
export const PATCH = handleApi(async (req: NextRequest, { params }: { params: { id: string } }) => {
  const user = await requireUser(["OWNER"]);
  const body = patchSchema.parse(await req.json());

  const project = await prisma.project.findUnique({ where: { id: params.id }, include: { client: { select: { name: true } } } });
  if (!project) throw new ApiError(404, "Project not found");
  if (project.client.name === "Non-corporate (internal)") throw new ApiError(400, "A non-corporate job has no contract value");
  const lock = contractLock(project);

  const before = Number(project.contractValue);
  const next = Math.round(body.contractValue * 100) / 100;
  if (before === next) return NextResponse.json({ ok: true, unchanged: true });

  // only if nobody changed it in the meantime (e.g. a change order accepted a moment ago)
  const done = await prisma.project.updateMany({ where: { id: project.id, contractValue: project.contractValue }, data: { contractValue: next } });
  if (done.count === 0) throw new ApiError(409, "The contract value just changed — reload the page and try again");

  const approved = await prisma.changeOrder.aggregate({ where: { projectId: project.id, status: "APPROVED" }, _count: true, _sum: { costImpact: true } });
  await audit({
    entityType: "Project",
    entityId: project.id,
    actorId: user.id,
    actorName: user.name,
    action: "PROJECT_CONTRACT_VALUE_EDITED",
    diff: {
      project: project.name,
      status: project.status,
      from: before,
      to: next,
      reason: body.reason,
      approvedChangeOrdersIncluded: approved._count,
      afterConstructionStarted: lock.locked,
    } as never,
  });
  return NextResponse.json({ ok: true, from: before, to: next });
});
