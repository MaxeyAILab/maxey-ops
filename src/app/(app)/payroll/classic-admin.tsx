import Link from "next/link";
import type { PayrollRun } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { fmtDate, php } from "@/lib/format";
import { normalizeEntries, type PayrollEntry } from "@/lib/payroll";
import { runGross } from "@/lib/finance";
import { CHARGEABLE_STATUSES } from "@/lib/project-status";
import { Badge, Card, CardBody, CardHeader, Table, Td, Th } from "@/components/ui";
import {
  AddEmployeeForm,
  DeleteRunButton,
  GenerateRunForm,
  RemoveEmployeeButton,
} from "@/components/payroll-actions";

/**
 * The ORIGINAL Payroll admin layout (before the 2026-11-19 redesign), kept word for word so the Owner can switch back
 * at any time with /payroll?layout=classic. Same data, same buttons, same permissions — it is only a different screen.
 */
export async function ClassicPayrollAdmin({
  runs,
  canManageRuns,
  canDeleteRuns,
}: {
  runs: (PayrollRun & { project: { name: string } | null })[];
  canManageRuns: boolean;
  canDeleteRuns: boolean;
}) {
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
              title={project.isNonCorporate ? `${project.name} · Non-corporate` : project.name}
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
                        {canManageRuns && <Th />}
                      </tr>
                    </thead>
                    <tbody>
                      {project.assignments.map((a) => (
                        <tr key={a.id}>
                          <Td className="font-medium">{a.user.name}</Td>
                          <Td>{fmtDate(a.startDate)}</Td>
                          <Td className="text-right tabular-nums">{php(a.hourlyRate.toString())}</Td>
                          {canManageRuns && (
                            <Td className="text-right">
                              <RemoveEmployeeButton assignmentId={a.id} name={a.user.name} />
                            </Td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                ) : (
                  <p className="text-sm text-ink-400">
                    No employees yet — add them below so payroll can be generated.
                  </p>
                )}
                {canManageRuns && (
                  <div className="mt-3 rounded-lg border border-dashed border-ink-200 p-3">
                    <AddEmployeeForm projectId={project.id} employees={addable} />
                  </div>
                )}
              </div>

              {/* Generate + runs */}
              <div className="border-t border-ink-100 pt-4">
                <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-500">
                  Payroll runs
                </h4>
                {canManageRuns && <GenerateRunForm projectId={project.id} />}
                {projectRuns.length > 0 && (
                  <Table className="mt-3">
                    <thead>
                      <tr>
                        <Th>Period</Th>
                        <Th className="text-right">Workers</Th>
                        <Th className="text-right">Gross (labor cost)</Th>
                        <Th>Status</Th>
                        {canDeleteRuns && <Th />}
                      </tr>
                    </thead>
                    <tbody>
                      {projectRuns.map((run) => {
                        const entries = normalizeEntries(run.entries as unknown as PayrollEntry[]);
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
                            {canDeleteRuns && (
                              <Td className="text-right">
                                <DeleteRunButton
                                  runId={run.id}
                                  status={run.status}
                                  label={`${fmtDate(run.periodStart)} – ${fmtDate(run.periodEnd)}`}
                                />
                              </Td>
                            )}
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
          {canManageRuns && <GenerateRunForm />}
          {departmentRuns.length > 0 && (
            <Table>
              <thead>
                <tr>
                  <Th>Department</Th>
                  <Th>Period</Th>
                  <Th className="text-right">Workers</Th>
                  <Th className="text-right">Total net</Th>
                  <Th>Status</Th>
                  {canDeleteRuns && <Th />}
                </tr>
              </thead>
              <tbody>
                {departmentRuns.map((run) => {
                  const entries = normalizeEntries(run.entries as unknown as PayrollEntry[]);
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
                      {canDeleteRuns && (
                        <Td className="text-right">
                          <DeleteRunButton
                            runId={run.id}
                            status={run.status}
                            label={`${run.department} ${fmtDate(run.periodStart)} – ${fmtDate(run.periodEnd)}`}
                          />
                        </Td>
                      )}
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
