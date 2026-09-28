import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { manilaDayKey, manilaTime } from "@/lib/time-rules";

/**
 * GET /api/cron/saturday-clockout — Vercel Cron hits this at 5:00 PM Manila
 * every Saturday (see vercel.json) and force-closes any still-open Office/
 * Driver shift from today, unless that worker has an APPROVED WEEKEND_WORK
 * request for today (an early delivery, a scheduled Saturday task, etc.).
 * Same shared-secret auth as the other cron route — no user session exists
 * for a cron invocation.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const todayKey = manilaDayKey(new Date());
  const fivePm = manilaTime(todayKey, 17, 0);

  const open = await prisma.attendance.findMany({
    where: {
      timeOut: null,
      user: { department: { in: ["OFFICE", "DRIVER"] } },
    },
    include: { user: { select: { id: true, name: true } } },
  });
  const todaysOpenShifts = open.filter((a) => manilaDayKey(a.timeIn) === todayKey);

  if (todaysOpenShifts.length === 0) {
    return NextResponse.json({ closed: 0 });
  }

  const approvedWeekend = await prisma.timeAdjustmentRequest.findMany({
    where: {
      userId: { in: todaysOpenShifts.map((a) => a.userId) },
      type: "WEEKEND_WORK",
      status: "APPROVED",
    },
  });
  const approvedUserIds = new Set(
    approvedWeekend.filter((w) => w.date && manilaDayKey(w.date) === todayKey).map((w) => w.userId)
  );

  const toClose = todaysOpenShifts.filter((a) => !approvedUserIds.has(a.userId));

  if (toClose.length > 0) {
    await prisma.attendance.updateMany({
      where: { id: { in: toClose.map((a) => a.id) } },
      data: { timeOut: fivePm },
    });
    await Promise.all(
      toClose.map((a) =>
        audit({
          entityType: "Attendance",
          entityId: a.id,
          actorId: null,
          actorName: "System (Saturday auto clock-out)",
          action: "TIME_OUT_AUTO",
          diff: { employee: a.user.name, at: fivePm.toISOString() },
        })
      )
    );
  }

  return NextResponse.json({ closed: toClose.length, exempted: approvedUserIds.size });
}
