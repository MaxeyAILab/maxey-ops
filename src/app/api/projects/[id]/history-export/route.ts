import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canViewFinding } from "@/lib/findings";
import { summarizeDiff, toCsv } from "@/lib/history";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";

const stamp = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Manila",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/**
 * GET /api/projects/[id]/history-export — Owner/PM download the project's audit trail as CSV
 * (who did what, when). Money is left out when the viewer has "Hide figures" switched on
 * (?figures=hidden) — the export, not just the screen, honours it. Cells are escaped, and any
 * that start with = + - @ are neutralised so a spreadsheet can't run them as formulas.
 */
export const GET = handleApi(async (req: NextRequest, { params }: { params: { id: string } }) => {
  const user = await requireUser(["OWNER", "PM"]);
  const allowMoney = req.nextUrl.searchParams.get("figures") !== "hidden";

  const project = await prisma.project.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      name: true,
      progressEntries: { select: { id: true } },
      changeOrders: { select: { id: true } },
      rfis: { select: { id: true } },
      workRequests: { select: { id: true } },
      milestones: { select: { id: true } },
      paymentTerms: { select: { id: true } },
      payments: { select: { id: true } },
      requisitions: { select: { id: true } },
      documents: { select: { id: true } },
      closeoutItems: { select: { id: true } },
      dailyReports: { select: { id: true } },
      findings: { select: { id: true, restricted: true, raisedById: true, ownerId: true } },
    },
  });
  if (!project) throw new ApiError(404, "Project not found");

  const ids = [
    project.id,
    ...project.progressEntries.map((r) => r.id),
    ...project.changeOrders.map((r) => r.id),
    ...project.rfis.map((r) => r.id),
    ...project.workRequests.map((r) => r.id),
    ...project.milestones.map((r) => r.id),
    ...project.paymentTerms.map((r) => r.id),
    ...project.payments.map((r) => r.id),
    ...project.requisitions.map((r) => r.id),
    ...project.documents.map((r) => r.id),
    ...project.closeoutItems.map((r) => r.id),
    ...project.dailyReports.map((r) => r.id),
    // Restricted findings only if this person may see them.
    ...project.findings.filter((f) => canViewFinding(f, { id: user.id, role: user.role })).map((f) => f.id),
  ];

  const entries = await prisma.auditLog.findMany({
    where: { OR: [{ entityId: { in: ids } }, { diff: { path: ["project"], equals: project.name } }] },
    orderBy: { createdAt: "asc" },
    take: 5000,
  });

  const csv = toCsv(
    ["When (Manila)", "Record type", "Event", "By", "Details"],
    entries.map((e) => [stamp.format(e.createdAt).replace(",", ""), e.entityType, e.action.replace(/_/g, " ").toLowerCase(), e.actorName, summarizeDiff(e.diff, allowMoney)])
  );

  const safeName = project.name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 60);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeName}-history.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
});
