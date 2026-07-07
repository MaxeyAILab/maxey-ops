import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";

const clockSchema = z.object({
  clientUuid: z.string().uuid(),
  submittedAt: z.coerce.date(), // device time at the moment of tap (Spec §4)
  type: z.enum(["IN", "OUT"]),
  projectId: z.string().optional().or(z.literal("")),
  gps: z.string().max(100).optional().or(z.literal("")),
});

/**
 * POST /api/attendance — time in/out tap, offline-capable (Spec 6.5).
 * IN creates an open entry; OUT closes the latest open one. Replays from the
 * outbox resolve to 409 (already applied), which the outbox treats as synced.
 */
export const POST = handleApi(async (req: NextRequest) => {
  const user = await requireUser(); // every staff role clocks time
  if (user.role === "CLIENT") throw new ApiError(403, "Clients do not clock time");
  const body = clockSchema.parse(await req.json());

  const offlineSynced = Date.now() - body.submittedAt.getTime() > 2 * 60_000;
  const source = offlineSynced ? "offline_synced" : "online";

  const openEntry = await prisma.attendance.findFirst({
    where: { userId: user.id, timeOut: null },
    orderBy: { timeIn: "desc" },
  });

  if (body.type === "IN") {
    const dup = await prisma.attendance.findUnique({ where: { clientUuid: body.clientUuid } });
    if (dup) return NextResponse.json({ error: "Already synced" }, { status: 409 });
    if (openEntry) {
      return NextResponse.json({ error: "Already clocked in" }, { status: 409 });
    }
    const entry = await prisma.attendance.create({
      data: {
        clientUuid: body.clientUuid,
        userId: user.id,
        projectId: body.projectId || null,
        timeIn: body.submittedAt,
        gpsIn: body.gps || null,
        source,
      },
    });
    await audit({
      entityType: "Attendance",
      entityId: entry.id,
      actorId: user.id,
      actorName: user.name,
      action: "TIME_IN",
      diff: { at: body.submittedAt.toISOString(), gps: body.gps || null, source },
    });
    return NextResponse.json(entry, { status: 201 });
  }

  // OUT
  if (!openEntry) {
    // Nothing open — either a replay of an already-applied OUT or a stray tap
    return NextResponse.json({ error: "No open time-in" }, { status: 409 });
  }
  if (body.submittedAt <= openEntry.timeIn) {
    throw new ApiError(400, "Time-out must be after time-in");
  }
  const entry = await prisma.attendance.update({
    where: { id: openEntry.id },
    data: { timeOut: body.submittedAt, gpsOut: body.gps || null },
  });
  await audit({
    entityType: "Attendance",
    entityId: entry.id,
    actorId: user.id,
    actorName: user.name,
    action: "TIME_OUT",
    diff: { at: body.submittedAt.toISOString(), gps: body.gps || null, source },
  });
  return NextResponse.json(entry);
});
