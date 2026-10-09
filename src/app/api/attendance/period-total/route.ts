import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import { computePeriodBaseHours } from "@/lib/payroll";

const schema = z.object({
  userId: z.string().min(1),
  projectId: z.string().nullable().optional(), // site crews: the project whose weekly total this is
  total: z.coerce.number().min(0).max(500),
});

/**
 * POST /api/attendance/period-total — Owner sets one employee's TOTAL hours
 * for their current pay period (semi-monthly for office staff, Friday-to-Friday
 * weekly for drivers and site crews). Stored as a signed delta against the
 * computed total so later clock-ins keep accumulating; payroll adds the delta
 * to regular hours when the period's run is generated.
 */
export const POST = handleApi(async (req: NextRequest) => {
  const user = await requireUser(["OWNER"]);
  const body = schema.parse(await req.json());
  const projectId = body.projectId ?? "";

  const computed = await computePeriodBaseHours(body.userId, projectId || null);
  if (!computed) throw new ApiError(404, "Employee not found");

  const delta = Math.round((body.total - computed.base) * 100) / 100;
  const where = {
    userId_projectId_periodStart: {
      userId: body.userId,
      projectId,
      periodStart: computed.period.start,
    },
  };

  if (Math.abs(delta) < 0.005) {
    await prisma.periodHoursAdjustment.deleteMany({
      where: { userId: body.userId, projectId, periodStart: computed.period.start },
    });
  } else {
    await prisma.periodHoursAdjustment.upsert({
      where,
      create: {
        userId: body.userId,
        projectId,
        periodStart: computed.period.start,
        deltaHours: delta,
        setById: user.id,
      },
      update: { deltaHours: delta, setById: user.id, setAt: new Date() },
    });
  }

  await audit({
    entityType: "PeriodHoursAdjustment",
    entityId: body.userId,
    actorId: user.id,
    actorName: user.name,
    action: "PERIOD_TOTAL_SET",
    diff: {
      employee: computed.user.name,
      period: computed.period.label,
      computed: Math.round(computed.base * 100) / 100,
      total: body.total,
      delta,
    },
  });

  return NextResponse.json({ ok: true, delta });
});
