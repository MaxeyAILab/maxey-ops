import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";

const createSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(5000),
  costImpact: z.coerce.number().default(0),
  timeImpactDays: z.coerce.number().int().default(0),
  asPotential: z.boolean().optional().default(false), // save internally; not sent to the client
  estimatedCost: z.coerce.number().min(0).optional().nullable(), // potential only; blank = not priced yet
  reason: z.string().max(2000).optional().nullable(),
});

/**
 * POST /api/change-orders — log additional work / scope change for client
 * approval in the portal (Spec 6.8).
 */
export const POST = handleApi(async (req: NextRequest) => {
  const user = await requireUser(["OWNER", "PM"]);
  const body = createSchema.parse(await req.json());

  const project = await prisma.project.findUnique({
    where: { id: body.projectId },
    include: { client: true },
  });
  if (!project) throw new ApiError(404, "Project not found");

  const co = await prisma.changeOrder.create({
    data: {
      projectId: body.projectId,
      title: body.title,
      description: body.description,
      // A potential change carries only an optional estimate: its costImpact stays 0 until it is
      // priced and sent, so it can never be mistaken for (or counted as) an approved amount.
      costImpact: body.asPotential ? 0 : body.costImpact,
      estimatedCost: body.asPotential ? (body.estimatedCost ?? null) : null,
      timeImpactDays: body.timeImpactDays,
      reason: body.reason || null,
      status: body.asPotential ? "POTENTIAL" : "PENDING_CLIENT",
      createdById: user.id,
    },
  });

  await audit({
    entityType: "ChangeOrder",
    entityId: co.id,
    actorId: user.id,
    actorName: user.name,
    action: body.asPotential ? "CHANGE_ORDER_POTENTIAL_LOGGED" : "CHANGE_ORDER_CREATED",
    diff: { project: project.name, costImpact: body.asPotential ? null : body.costImpact, estimatedCost: body.asPotential ? (body.estimatedCost ?? null) : null, days: body.timeImpactDays },
  });
  if (!body.asPotential) {
    await notify({
      to: { name: project.client.name, email: project.client.email, phone: project.client.phone },
      subject: "Change order awaiting your approval",
      message: `${body.title} — please review it in your Maxey Construction client portal.`,
    });
  }

  return NextResponse.json(co, { status: 201 });
});
