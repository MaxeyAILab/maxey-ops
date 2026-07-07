import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";

const createSchema = z.object({
  projectId: z.string().min(1),
  userId: z.string().min(1),
  startDate: z.coerce.date(), // date the employee started on the project
  hourlyRate: z.coerce.number().positive(),
});

/**
 * POST /api/assignments — add an employee to a project's payroll roster
 * (Payroll tab "Add employee"). Re-adding a removed employee reactivates the
 * assignment with the new start date and rate.
 */
export const POST = handleApi(async (req: NextRequest) => {
  const user = await requireUser(["OWNER", "ACCOUNTING"]);
  const body = createSchema.parse(await req.json());

  const [project, employee] = await Promise.all([
    prisma.project.findUnique({ where: { id: body.projectId } }),
    prisma.user.findUnique({ where: { id: body.userId } }),
  ]);
  if (!project) throw new ApiError(404, "Project not found");
  if (!employee || employee.role === "CLIENT" || !employee.active) {
    throw new ApiError(400, "Not a valid employee");
  }

  const existing = await prisma.projectAssignment.findUnique({
    where: { projectId_userId: { projectId: body.projectId, userId: body.userId } },
  });
  if (existing?.active) throw new ApiError(400, `${employee.name} is already on this project`);

  const assignment = existing
    ? await prisma.projectAssignment.update({
        where: { id: existing.id },
        data: { active: true, startDate: body.startDate, hourlyRate: body.hourlyRate },
      })
    : await prisma.projectAssignment.create({
        data: {
          projectId: body.projectId,
          userId: body.userId,
          startDate: body.startDate,
          hourlyRate: body.hourlyRate,
        },
      });

  await audit({
    entityType: "ProjectAssignment",
    entityId: assignment.id,
    actorId: user.id,
    actorName: user.name,
    action: "EMPLOYEE_ASSIGNED",
    diff: {
      project: project.name,
      employee: employee.name,
      startDate: body.startDate.toISOString().slice(0, 10),
      hourlyRate: body.hourlyRate,
    },
  });

  return NextResponse.json(assignment, { status: 201 });
});
