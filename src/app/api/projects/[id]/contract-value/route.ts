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
 * PATCH /api/projects/[id]/contract-value — Owner only. Revises the project cost (contract value) while the project is still in
 * Site Survey or Mobilization. Once construction has started it is final and this refuses; from then on the contract value only
 * changes through a change order the client approves. Every revision is recorded with the old and new value and the reason.
 */
export const PATCH = handleApi(async (req: NextRequest, { params }: { params: { id: string } }) => {
  const user = await requireUser(["OWNER"]);
  const body = patchSchema.parse(await req.json());

  const project = await prisma.project.findUnique({ where: { id: params.id }, include: { client: { select: { name: true } } } });
  if (!project) throw new ApiError(404, "Project not found");
  if (project.client.name === "Non-corporate (internal)") throw new ApiError(400, "A non-corporate job has no contract value");
  const lock = contractLock(project);
  if (lock.locked) throw new ApiError(409, lock.message ?? "The contract value is final");

  const before = Number(project.contractValue);
  const next = Math.round(body.contractValue * 100) / 100;
  if (before === next) return NextResponse.json({ ok: true, unchanged: true });

  // the claim re-checks the lock, so a status change made a moment ago cannot be overtaken by this edit
  const done = await prisma.project.updateMany({
    where: { id: project.id, costLockedAt: null, status: { in: ["SITE_SURVEY", "MOBILIZATION", "NOT_ACTIVE", "ON_HOLD"] } },
    data: { contractValue: next },
  });
  if (done.count === 0) throw new ApiError(409, "The contract value was just locked — construction has started");

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
    } as never,
  });
  return NextResponse.json({ ok: true, from: before, to: next });
});
