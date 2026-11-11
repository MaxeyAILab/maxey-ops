import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import { setOfficePayroll } from "@/lib/office-payroll";

const schema = z.object({
  /** the first Manila day paid by the office payroll, e.g. "2026-11-01"; null moves the person back to the project payroll */
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
});

/**
 * PUT /api/personnel/[id]/office-payroll — Owner only. Pays a person who works on a project (such as the project engineer) through
 * the office's semi-monthly payroll (1st–15th, 16th–end of the month) from a date, instead of the project's weekly crew payroll: their
 * time is then left out of the project's runs, counted in the office run, and shown on its own panel of the timekeeper sheet. Refuses
 * when it would pay the same days twice. A line in a project run that is still a draft is taken out. Audited.
 */
export const PUT = handleApi(async (req: NextRequest, { params }: { params: { id: string } }) => {
  const user = await requireUser(["OWNER"]);
  const body = schema.parse(await req.json());
  const target = await prisma.user.findUnique({ where: { id: params.id }, select: { id: true, name: true, department: true, officePayrollFrom: true } });
  if (!target) throw new ApiError(404, "Person not found");

  const before = target.officePayrollFrom ? target.officePayrollFrom.toISOString().slice(0, 10) : null;
  const change = await prisma.$transaction((db) => setOfficePayroll(db, { userId: target.id, from: body.from }));

  await audit({
    entityType: "User",
    entityId: target.id,
    actorId: user.id,
    actorName: user.name,
    action: body.from ? "PERSONNEL_OFFICE_PAYROLL_SET" : "PERSONNEL_OFFICE_PAYROLL_CLEARED",
    diff: { name: target.name, department: target.department, from: before, to: body.from, removedFromDraftRuns: change.removedFromRuns } as never,
  });
  return NextResponse.json({ ok: true, from: change.from, removedFromRuns: change.removedFromRuns });
});
