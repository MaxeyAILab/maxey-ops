import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fmtDate, php } from "@/lib/format";
import type { PayrollEntry } from "@/lib/payroll";
import { runGross } from "@/lib/finance";
import { CHARGEABLE_STATUSES } from "@/lib/project-status";
import { Badge, Card, CardBody, CardHeader, EmptyState, Table, Td, Th } from "@/components/ui";
import {
  AddEmployeeForm,
  GenerateRunForm,
  RemoveEmployeeButton,
} from "@/components/payroll-actions";

export const metadata = { title: "Payroll" };
export const dynamic = "force-dynamic";

/**
 * Payroll — separate per project (Spec 6.5 + owner's workflow). Each project
 * has its own employee roster (start date on the project + rate/hr) and its
 * own runs; approved runs post as labor into the project's committed cost.
 * Office staff and drivers, who have no project, run under Departments below.
 * Non-admin staff see only their own pay lines.
 */
export default async function PayrollPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role === "CLIENT") redirect("/portal");

  const isPayrollAdmin = ["OWNER", "ACCOUNTING"].includes(user.role);
  const runs = await prisma.payrollRun.findMany({
    orderBy: { periodStart: "desc" },
    include: { project: { select: { name: true } } },
  });

  if (!isPayrollAdmin) {
    const myLines = runs
      .map((run) => {
        const entries = run.entries as unknown as PayrollEntry[];
        const mine = entries.find((e) => e.userId === user.id);
        return mine ? { run, mine } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <h1 className="text-xl font-bold text-ink-900">My Pay</h1>
        <Card>
          <CardHeader title="My payslip history" subtitle="Only your own pay is visible to you" />
          {myLines.length === 0 ? (
            <CardBody>
              <EmptyState>No payroll records for you yet.</EmptyState>
            </CardBody>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Project / Dept</Th>
                  <Th>Period</Th>
                  <Th className="text-right">Hours (reg / OT)</Th>
                  <Th className="text-right">Net pay</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {myLines.map(({ run, mine }) => (
                  <tr key={run.id}>
                    <Td className="text-xs">{run.project?.name ?? run.department}</Td>
                    <Td className="text-xs">
                      {fmtDate(run.periodStart)} – {fmtDate(run.periodEnd)}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {mine.regularHours} / {mine.otHours}
                    </Td>
                    <Td className="text-right font-semibold tabular-nums text-emerald-700">
                      {php(mine.net)}
                    </Td>
                    <Td>
                      <Badge value={run.status} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    );
  }

  // ----- Admin view: one payroll block per project -----
  const [projects, employees] = await Promise.all([
    prisma.project.findMany({
      where: { status: { in: CHARGEABLE_STATUSES } },
      orderBy: { name: "asc" },
      include: {
        client: { select: { name: true } },
        assignments: {
          where: { active: true },
          orderBy: { user: { name: "asc" } },
          include: { user: { select: { id: true, name: true } } },
        },
      },
    }),
    prisma.user.findMany({
      where: { active: true, role: { not: "CLIENT" } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const departmentRuns = runs.filter((r) => !r.projectId);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold text-ink-900">Payroll — per project</h1>
        <p className="text-sm text-ink-500">
          Each project keeps its own employee roster and payroll runs. Approved runs post
          automatically as labor cost into that project&apos;s committed cost.
        </p>
      </div>

      {projects.map((project) => {
        const projectRuns = runs.filter((r) => r.projectId === project.id);
        const laborCommitted = projectRuns
          .filter((r) => ["APPROVED", "PAID"].includes(r.status))
          .reduce((s, r) => s + runGross(r.entries), 0);
        const rosterIds = new Set(project.assignments.map((a) => a.userId));
        const addable = employees.filter((e) => !rosterIds.has(e.id));

        return (
          <Card key={project.id}>
            <CardHeader
              title={project.name}
              subtitle={`${project.client.name} · labor committed to date: ${php(laborCommitted)}`}
              action={
                <Link
                  href={`/projects/${project.id}`}
                  className="text-xs font-medium text-brand-600 hover:underline"
                >
                  View project →
                </Link>
              }
            />
            <CardBody className="space-y-5">
              {/* Employee roster */}
              <div>
                <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-500">
                  Employees on this project ({project.assignments.length})
                </h4>
                {project.assignments.length > 0 ? (
                  <Table>
                    <thead>
                      <tr>
                        <Th>Employee</Th>
                        <Th>Started on project</Th>
                        <Th className="text-right">Rate / hour</Th>
                        <Th />
                      </tr>
                    </thead>
                    <tbody>
                      {project.assignments.map((a) => (
                        <tr key={a.id}>
                          <Td className="font-medium">{a.user.name}</Td>
                          <Td>{fmtDate(a.startDate)}</Td>
                          <Td className="text-right tabular-nums">{php(a.hourlyRate.toString())}</Td>
                          <Td className="text-right">
                            <RemoveEmployeeButton assignmentId={a.id} name={a.user.name} />
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                ) : (
                  <p className="text-sm text-ink-400">
                    No employees yet — add them below so payroll can be generated.
                  </p>
                )}
                <div className="mt-3 rounded-lg border border-dashed border-ink-200 p-3">
                  <AddEmployeeForm projectId={project.id} employees={addable} />
                </div>
              </div>

              {/* Generate + runs */}
              <div className="border-t border-ink-100 pt-4">
                <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-500">
                  Payroll runs
                </h4>
                <GenerateRunForm projectId={project.id} />
                {projectRuns.length > 0 && (
                  <Table className="mt-3">
                    <thead>
                      <tr>
                        <Th>Period</Th>
                        <Th className="text-right">Workers</Th>
                        <Th className="text-right">Gross (labor cost)</Th>
                        <Th>Status</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {projectRuns.map((run) => {
                        const entries = run.entries as unknown as PayrollEntry[];
                        return (
                          <tr key={run.id} className="hover:bg-ink-50">
                            <Td>
                              <Link
                                href={`/payroll/${run.id}`}
                                className="font-medium text-brand-600 hover:underline"
                              >
                                {fmtDate(run.periodStart)} – {fmtDate(run.periodEnd)}
                              </Link>
                            </Td>
                            <Td className="text-right tabular-nums">{entries.length}</Td>
                            <Td className="text-right tabular-nums">{php(runGross(entries))}</Td>
                            <Td>
                              <Badge value={run.status} />
                            </Td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </Table>
                )}
              </div>
            </CardBody>
          </Card>
        );
      })}

      {/* Office & drivers — no project */}
      <Card>
        <CardHeader
          title="Office & Driver payroll (non-project)"
          subtitle="Staff without a project assignment, computed from their profile rates"
        />
        <CardBody className="space-y-4">
          <GenerateRunForm />
          {departmentRuns.length > 0 && (
            <Table>
              <thead>
                <tr>
                  <Th>Department</Th>
                  <Th>Period</Th>
                  <Th className="text-right">Workers</Th>
                  <Th className="text-right">Total net</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {departmentRuns.map((run) => {
                  const entries = run.entries as unknown as PayrollEntry[];
                  return (
                    <tr key={run.id} className="hover:bg-ink-50">
                      <Td>
                        <Link
                          href={`/payroll/${run.id}`}
                          className="font-medium text-brand-600 hover:underline"
                        >
                          {run.department}
                        </Link>
                      </Td>
                      <Td className="text-xs">
                        {fmtDate(run.periodStart)} – {fmtDate(run.periodEnd)}
                      </Td>
                      <Td className="text-right tabular-nums">{entries.length}</Td>
                      <Td className="text-right tabular-nums">
                        {php(entries.reduce((s, e) => s + e.net, 0))}
                      </Td>
                      <Td>
                        <Badge value={run.status} />
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
