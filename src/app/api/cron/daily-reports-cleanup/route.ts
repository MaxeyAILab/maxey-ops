import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { DAILY_REPORT_LIFETIME_DAYS } from "@/lib/daily-reports";

/**
 * GET /api/cron/daily-reports-cleanup — Vercel Cron hits this once a day
 * (see vercel.json) to purge Daily Construction Reports past their 7-day
 * lifetime. No user session exists for a cron invocation, so auth is a
 * shared secret instead of requireUser() — Vercel sends it automatically as
 * `Authorization: Bearer $CRON_SECRET` once that env var is set on the
 * project. Requests without a matching secret are rejected outright.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - DAILY_REPORT_LIFETIME_DAYS * 24 * 60 * 60 * 1000);
  const expired = await prisma.dailyConstructionReport.findMany({
    where: { createdAt: { lt: cutoff } },
    select: { id: true, reportNo: true, project: { select: { name: true } } },
  });

  if (expired.length > 0) {
    await prisma.dailyConstructionReport.deleteMany({
      where: { id: { in: expired.map((r) => r.id) } },
    });
    await Promise.all(
      expired.map((r) =>
        audit({
          entityType: "DailyConstructionReport",
          entityId: r.id,
          actorId: null,
          actorName: "System (auto-cleanup)",
          action: "DAILY_REPORT_AUTO_DELETED",
          diff: { project: r.project.name, reportNo: r.reportNo, lifetimeDays: DAILY_REPORT_LIFETIME_DAYS },
        })
      )
    );
  }

  return NextResponse.json({ deleted: expired.length });
}
