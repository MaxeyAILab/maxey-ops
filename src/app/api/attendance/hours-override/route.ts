import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";

const schema = z.object({
  userId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // Manila calendar date
  hours: z.coerce.number().min(0).max(24),
  approvedOver8: z.boolean().optional().default(false),
});

/**
 * POST /api/attendance/hours-override — Owner corrects one employee's one
 * day of computed hours (a buddy-punch glitch, a forgotten clock-out, etc.).
 * Setting it IS the approval — there's no separate review step, since only
 * the Owner can call this. Hours over 8 are rejected unless approvedOver8 is
 * checked, so a typo can't silently blow past the standard cap. The override
 * replaces computeEffectiveHours()'s result for that user+day everywhere
 * (attendance summary and payroll both read it) — the underlying Attendance
 * row itself is never touched.
 */
export const POST = handleApi(async (req: NextRequest) => {
  const user = await requireUser(["OWNER"]);
  const body = schema.parse(await req.json());

  if (body.hours > 8 && !body.approvedOver8) {
    throw new ApiError(400, "Check the approval box to set more than 8 hours for this day");
  }

  const target = await prisma.user.findUnique({ where: { id: body.userId } });
  if (!target) throw new ApiError(404, "Employee not found");

  const date = new Date(`${body.date}T00:00:00.000Z`);
  const override = await prisma.dailyHoursOverride.upsert({
    where: { userId_date: { userId: body.userId, date } },
    create: {
      userId: body.userId,
      date,
      hours: body.hours,
      approvedOver8: body.approvedOver8,
      setById: user.id,
    },
    update: {
      hours: body.hours,
      approvedOver8: body.approvedOver8,
      setById: user.id,
      setAt: new Date(),
    },
  });

  await audit({
    entityType: "DailyHoursOverride",
    entityId: override.id,
    actorId: user.id,
    actorName: user.name,
    action: "HOURS_OVERRIDE_SET",
    diff: { employee: target.name, date: body.date, hours: body.hours, approvedOver8: body.approvedOver8 },
  });

  return NextResponse.json(override);
});
