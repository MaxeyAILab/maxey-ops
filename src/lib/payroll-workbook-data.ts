import type { PrismaClient } from "@prisma/client";
import { normalizeEntries, otMultiplierFor, type PayrollEntry } from "@/lib/payroll";
import { fileKindOf, isFinalRun, periodKeyOf, sheetOrder, type PayrollFileKind } from "@/lib/payroll-export";
import type { WorkbookInput, WorkbookRun } from "@/lib/payroll-workbook";
import { JOB_ROLES, isJobRole } from "@/lib/role-presets";

const DEPT_LABEL: Record<string, string> = { DRIVER: "Drivers", OFFICE: "Office", ENGINEER: "Engineers", ARCHITECT: "Architects", SITE: "Site" };
const DEPT_DESIGNATION: Record<string, string> = { DRIVER: "Driver", OFFICE: "Office staff", ENGINEER: "Engineer", ARCHITECT: "Architect", SITE: "Site worker" };

/**
 * Everything the payroll workbook of one pay period needs, read from the database (read-only): the approved / paid runs of that
 * period and kind, each line with the person's employee ID and designation, and the runs of the period not approved yet.
 * Returns null when the period has no approved run.
 */
export async function loadPayrollWorkbook(db: PrismaClient, kind: PayrollFileKind, period: string, generatedBy: string): Promise<{ input: WorkbookInput; runIds: string[] } | null> {
  const [a, b] = period.split("_");
  const from = new Date(`${a}T00:00:00+08:00`);
  const to = new Date(`${b}T23:59:59+08:00`);
  // a little wider window by date, then exactly by Manila day key
  const candidates = await db.payrollRun.findMany({
    where: { periodStart: { gte: new Date(from.getTime() - 86_400_000) }, periodEnd: { lte: new Date(to.getTime() + 86_400_000) } },
    include: { project: { select: { name: true, address: true } } },
  });
  const inPeriod = candidates.filter((r) => fileKindOf(r) === kind && periodKeyOf(r) === period);
  const final = inPeriod.filter((r) => isFinalRun(r.status));
  if (final.length === 0) return null;

  const userIds = [...new Set(final.flatMap((r) => (r.entries as unknown as PayrollEntry[]).map((e) => e.userId)))];
  const people = new Map(
    (await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, employeeNo: true, position: true, jobRole: true, department: true, monthlySalary: true } })).map((u) => [u.id, u]),
  );
  const nameOf = (r: (typeof inPeriod)[number]) => r.project?.name ?? DEPT_LABEL[r.department ?? ""] ?? r.department ?? "Payroll";

  const runs: WorkbookRun[] = sheetOrder(final.map((r) => ({ ...r, name: nameOf(r) }))).map((r) => ({
    id: r.id,
    projectId: r.projectId,
    name: r.name,
    location: r.project ? r.project.address : null,
    status: r.status,
    approvedByName: r.approvedByName,
    approvedAt: r.approvedAt,
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    otMultiplier: otMultiplierFor(r.department),
    lines: normalizeEntries(r.entries as unknown as PayrollEntry[]).map((e) => {
      const u = people.get(e.userId);
      const designation = u?.position?.trim() || (u?.jobRole && isJobRole(u.jobRole) ? JOB_ROLES[u.jobRole].label : "") || DEPT_DESIGNATION[r.department ?? u?.department ?? ""] || "";
      return { ...e, employeeNo: u?.employeeNo ?? null, designation, monthlySalary: u?.monthlySalary != null ? Number(u.monthlySalary) : null };
    }),
  }));

  return {
    runIds: runs.map((r) => r.id),
    input: {
      kind,
      periodStart: new Date(Math.min(...final.map((r) => r.periodStart.getTime()))),
      periodEnd: new Date(Math.max(...final.map((r) => r.periodEnd.getTime()))),
      runs,
      waiting: inPeriod.filter((r) => r.status === "DRAFT" || r.status === "REVIEW").map((r) => ({ name: nameOf(r), status: r.status })),
      generatedBy,
      generatedAt: new Date(),
    },
  };
}
