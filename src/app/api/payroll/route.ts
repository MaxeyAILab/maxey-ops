import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { computePayroll, computeProjectPayroll } from "@/lib/payroll";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// A run is either per-project (site crews) or per-department (office/drivers)
const createSchema = z
  .object({
    projectId: z.string().min(1).optional(),
    department: z.enum(["OFFICE", "DRIVER"]).optional(),
    periodStart: dateStr,
    periodEnd: dateStr,
  })
  .refine((b) => !!b.projectId !== !!b.department, {
    message: "Provide either a project or a department, not both",
  });

/** Anchor a yyyy-mm-dd to Manila local time (Spec §8 localization). */
function manilaDate(d: string, endOfDay = false): Date {
  return new Date(`${d}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}+08:00`);
}

/**
 * POST /api/payroll — generate a payroll run (Spec 6.5). Project runs pull
 * the roster + rates from ProjectAssignment; approved runs post as labor cost
 * against the project's committed cost automatically.
 */
export const POST = handleApi(async (req: NextRequest) => {
  const user = await requireUser(["OWNER", "ACCOUNTING"]);
  const body = createSchema.parse(await req.json());
  const periodStart = manilaDate(body.periodStart);
  const periodEnd = manilaDate(body.periodEnd, true);
  if (periodEnd <= periodStart) {
    throw new ApiError(400, "Period end must be after period start");
  }

  let entries;
  let projectName: string | null = null;
  if (body.projectId) {
    const project = await prisma.project.findUnique({ where: { id: body.projectId } });
    if (!project) throw new ApiError(404, "Project not found");
    projectName = project.name;
    entries = await computeProjectPayroll(body.projectId, periodStart, periodEnd);
    if (entries.length === 0) {
      throw new ApiError(
        400,
        "No payable attendance in that period — check the employee roster, project start dates, and that time in/out was clocked against this project"
      );
    }
  } else {
    entries = await computePayroll(body.department!, periodStart, periodEnd);
    if (entries.length === 0) {
      throw new ApiError(400, "No completed attendance records in that period for this department");
    }
  }

  const run = await prisma.payrollRun.create({
    data: {
      projectId: body.projectId ?? null,
      department: body.department ?? null,
      periodStart,
      periodEnd,
      entries: entries as never,
      status: "DRAFT",
    },
  });

  await audit({
    entityType: "PayrollRun",
    entityId: run.id,
    actorId: user.id,
    actorName: user.name,
    action: "PAYROLL_RUN_GENERATED",
    diff: {
      project: projectName,
      department: body.department ?? null,
      workers: entries.length,
      totalNet: entries.reduce((s, e) => s + e.net, 0),
    },
  });

  return NextResponse.json(run, { status: 201 });
});
