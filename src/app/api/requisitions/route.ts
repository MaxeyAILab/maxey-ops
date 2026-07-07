import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { notifyOwner } from "@/lib/notify";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";

const itemSchema = z.object({
  name: z.string().min(1).max(200),
  spec: z.string().max(500).optional().or(z.literal("")),
  qty: z.coerce.number().positive(),
  unit: z.string().min(1).max(30),
});

const createSchema = z.object({
  clientUuid: z.string().uuid(), // idempotency key from the device (Spec §4)
  submittedAt: z.coerce.date(), // device time at moment of action, not sync time
  projectId: z.string().min(1),
  urgency: z.enum(["LOW", "NORMAL", "HIGH", "CRITICAL"]).default("NORMAL"),
  neededBy: z.coerce.date().optional(),
  notes: z.string().max(2000).optional().or(z.literal("")),
  items: z.array(itemSchema).min(1),
});

/**
 * POST /api/requisitions — field submission (offline-capable). Replays from
 * the outbox are deduplicated by clientUuid: a repeat POST returns 409, which
 * the outbox treats as already-synced.
 */
export const POST = handleApi(async (req: NextRequest) => {
  const user = await requireUser(["FOREMAN", "PM", "OWNER"]);
  const body = createSchema.parse(await req.json());

  const existing = await prisma.requisition.findUnique({
    where: { clientUuid: body.clientUuid },
  });
  if (existing) {
    return NextResponse.json({ error: "Already synced", id: existing.id }, { status: 409 });
  }

  const project = await prisma.project.findUnique({ where: { id: body.projectId } });
  if (!project) throw new ApiError(400, "Unknown project");

  // Entries that arrive well after their device timestamp came through the
  // offline queue — flag them so reviewers know the capture context.
  const offlineSynced = Date.now() - body.submittedAt.getTime() > 2 * 60_000;

  const requisition = await prisma.requisition.create({
    data: {
      clientUuid: body.clientUuid,
      projectId: body.projectId,
      submittedById: user.id,
      submittedAt: body.submittedAt,
      urgency: body.urgency,
      neededBy: body.neededBy,
      notes: body.notes || null,
      offlineSynced,
      items: {
        create: body.items.map((i) => ({
          name: i.name,
          spec: i.spec || null,
          qty: i.qty,
          unit: i.unit,
        })),
      },
    },
    include: { items: true },
  });

  await audit({
    entityType: "Requisition",
    entityId: requisition.id,
    actorId: user.id,
    actorName: user.name,
    action: "REQUISITION_SUBMITTED",
    diff: { project: project.name, items: body.items.length, offlineSynced },
  });
  // Replaces the "call/text Jacob" step (Spec 6.2)
  await notifyOwner(
    "Requisition awaiting approval",
    `${user.name} requested ${body.items.length} item(s) for ${project.name} (${body.urgency})`
  );

  return NextResponse.json(requisition, { status: 201 });
});

/** GET /api/requisitions — list, scoped by role (drivers view for pickups). */
export const GET = handleApi(async () => {
  const user = await requireUser(["FOREMAN", "PM", "OWNER", "PURCHASING", "ACCOUNTING", "DRIVER"]);
  const where = user.role === "FOREMAN" ? { submittedById: user.id } : {};
  const requisitions = await prisma.requisition.findMany({
    where,
    orderBy: { submittedAt: "desc" },
    include: {
      items: true,
      project: { select: { name: true } },
      submittedBy: { select: { name: true } },
      purchaseOrder: { select: { poNumber: true } },
    },
  });
  return NextResponse.json(requisitions);
});
