import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import { computeWorkItemStatuses, weightedAccomplishment, weightedContribution } from "@/lib/progress";

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function csvRow(cells: (string | number)[]): string {
  return cells.map(csvCell).join(",") + "\r\n";
}

/**
 * GET /api/projects/[id]/accomplishment-export — downloadable CSV of the
 * weighted accomplishment breakdown (opens directly in Excel; File > Import
 * in Google Sheets). Same roles that can see the project detail page.
 */
export const GET = handleApi(async (_req: NextRequest, { params }: { params: { id: string } }) => {
  await requireUser(["OWNER", "PM", "FOREMAN", "ACCOUNTING", "PURCHASING"]);

  const project = await prisma.project.findUnique({
    where: { id: params.id },
    include: { progressEntries: { orderBy: { createdAt: "asc" } } },
  });
  if (!project) throw new ApiError(404, "Project not found");

  const statuses = computeWorkItemStatuses(project.progressEntries);
  const overall = weightedAccomplishment(statuses);
  const totalWeight = statuses.reduce((s, x) => s + x.weight, 0);

  let csv = "";
  csv += csvRow(["Project", project.name]);
  csv += csvRow(["Generated", new Date().toISOString()]);
  csv += csvRow(["Overall weighted accomplishment (%)", overall.toFixed(2)]);
  csv += csvRow(["Total weight accounted for (%)", totalWeight.toFixed(2)]);
  csv += "\r\n";
  csv += csvRow([
    "Work item",
    "Weight (%)",
    "Completion (%)",
    "Weighted contribution (pts)",
    "Color",
    "Last updated",
  ]);
  for (const s of statuses) {
    csv += csvRow([
      s.workItem,
      s.weight.toFixed(2),
      s.pctComplete.toFixed(2),
      weightedContribution(s).toFixed(2),
      s.color,
      s.lastUpdated.toISOString(),
    ]);
  }
  if (statuses.length === 0) {
    csv += csvRow(["No weighted work items recorded yet."]);
  }

  const fileName = `accomplishment-${project.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`;
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
});
