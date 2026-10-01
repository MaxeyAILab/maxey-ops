import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { computePayroll, computeProjectPayroll } from "@/lib/payroll";
import { manilaSemiMonthlyPeriod, manilaWeeklySitePeriod } from "@/lib/time-rules";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";

// A run is either per-project (site crews) or per-department (office/drivers)
const createSchema = z
  .object({
    projectId: z.string().min(1).optional(),
    department: z.enum(["OFFICE", "DRIVER", "ARCHITECT", "ENGINEER"]).optional(),
    // Which aligned period to generate — 0 = current, 1 = the one before that,
    // etc. Never a free date range: periods are always computed here, so a
    // run can't drift out of alignment with the last one (Spec: Office runs
    // semi-monthly 1st–15th/16th–end; Site crews and Drivers run weekly,
    // Friday 5:01 PM to the next Friday 5:00 PM).
    periodsBack: z.coerce.number().int().min(0).max(12).default(0),
  })
  .refine((b) => !!b.projectId !== !!b.department, {
    message: "Provide either a project or a department, not both",
  });

/**
 * POST /api/payroll — generate a payroll run (Spec 6.5). Project runs pull
 * the roster + rates from ProjectAssignment; approved runs post as labor cost
 * against the project's committed cost automatically.
 */
export const POST = handleApi(async (req: NextRequest) => {
  const user = await requireUser(["OWNER", "ACCOUNTING"]);
  const body = createSchema.parse(await req.json());

  const isWeekly = !!body.projectId || body.department === "DRIVER";
  const period = isWeekly
    ? manilaWeeklySitePeriod(new Date(), body.periodsBack)
    : manilaSemiMonthlyPeriod(new Date(), body.periodsBack);
  const periodStart = period.start;
  const periodEnd = period.end;

  const existing = await prisma.payrollRun.findFirst({
    where: {
      projectId: body.projectId ?? null,
      department: body.department ?? null,
      periodStart,
      periodEnd,
    },
  });
  if (existing) {
    throw new ApiError(400, `A run for ${period.label} already exists — open it instead of generating a duplicate`);
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
      period: period.label,
      workers: entries.length,
      totalNet: entries.reduce((s, e) => s + e.net, 0),
    },
  });

  return NextResponse.json(run, { status: 201 });
});
