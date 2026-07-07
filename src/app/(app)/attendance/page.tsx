import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fmtDateTime } from "@/lib/format";
import { Card, CardBody, CardHeader, Table, Td, Th } from "@/components/ui";
import { AttendanceClock } from "@/components/attendance-clock";
import { AddPersonnelSection, RemovePersonnelButton } from "@/components/personnel-actions";
import { CHARGEABLE_STATUSES } from "@/lib/project-status";
import type { Attendance } from "@prisma/client";

export const metadata = { title: "Attendance" };
export const dynamic = "force-dynamic";

const timeFmt = new Intl.DateTimeFormat("en-PH", {
  timeZone: "Asia/Manila",
  hour: "numeric",
  minute: "2-digit",
});

function summarize(records: Attendance[], todayStart: Date) {
  const open = records.find((r) => r.timeOut === null);
  const completed = records.filter((r) => r.timeOut !== null);
  const hours = (rs: Attendance[]) =>
    rs.reduce((s, r) => s + (r.timeOut!.getTime() - r.timeIn.getTime()) / 3_600_000, 0);
  const todayHours = hours(completed.filter((r) => r.timeIn >= todayStart));
  const weekHours = hours(completed);
  const loggedToday = !!open || completed.some((r) => r.timeIn >= todayStart);
  return { open, todayHours, weekHours, loggedToday };
}

function StatusCell({
  open,
  loggedToday,
}: {
  open: Attendance | undefined;
  loggedToday: boolean;
}) {
  if (open) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
        <span className="h-2 w-2 rounded-full bg-emerald-500" />
        On duty since {timeFmt.format(open.timeIn)}
      </span>
    );
  }
  if (loggedToday) {
    return <span className="text-xs font-medium text-blue-700">✓ Logged today</span>;
  }
  return <span className="text-xs text-red-500">Not logged in</span>;
}

export default async function AttendancePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role === "CLIENT") redirect("/portal");

  const isAdmin = ["OWNER", "ACCOUNTING", "PM"].includes(user.role);
  const canManagePersonnel = user.role === "OWNER"; // only the Owner creates/removes accounts

  // Manila day boundaries (payroll uses the same anchoring)
  const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
  const todayStart = new Date(`${todayStr}T00:00:00.000+08:00`);
  const weekStart = new Date(todayStart.getTime() - 6 * 86_400_000);

  const [me, openEntry, recent, projects] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.id } }),
    prisma.attendance.findFirst({
      where: { userId: user.id, timeOut: null },
      orderBy: { timeIn: "desc" },
    }),
    prisma.attendance.findMany({
      where: { userId: user.id },
      orderBy: { timeIn: "desc" },
      take: 10,
      include: { project: { select: { name: true } } },
    }),
    prisma.project.findMany({
      where: { status: { in: CHARGEABLE_STATUSES } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const needsProject = me?.department === "SITE" || me?.department === "DRIVER";

  // Admin summary data
  let siteSections: {
    projectId: string;
    projectName: string;
    rows: {
      userId: string;
      name: string;
      position: string;
      summary: ReturnType<typeof summarize>;
    }[];
  }[] = [];
  let officeRows: {
    userId: string;
    name: string;
    position: string;
    department: string;
    summary: ReturnType<typeof summarize>;
  }[] = [];

  if (isAdmin) {
    const [rosters, officeStaff, weekAttendance] = await Promise.all([
      prisma.project.findMany({
        where: { status: { in: CHARGEABLE_STATUSES }, assignments: { some: { active: true } } },
        orderBy: { name: "asc" },
        include: {
          assignments: {
            where: { active: true },
            orderBy: { user: { name: "asc" } },
            include: { user: { select: { id: true, name: true, position: true } } },
          },
        },
      }),
      prisma.user.findMany({
        where: {
          active: true,
          role: { not: "CLIENT" },
          department: { in: ["OFFICE", "DRIVER"] },
        },
        orderBy: [{ department: "asc" }, { name: "asc" }],
        select: { id: true, name: true, position: true, department: true },
      }),
      prisma.attendance.findMany({
        where: { OR: [{ timeIn: { gte: weekStart } }, { timeOut: null }] },
      }),
    ]);

    siteSections = rosters.map((p) => ({
      projectId: p.id,
      projectName: p.name,
      rows: p.assignments.map((a) => ({
        userId: a.user.id,
        name: a.user.name,
        position: a.user.position ?? "—",
        summary: summarize(
          weekAttendance.filter((r) => r.userId === a.userId && r.projectId === p.id),
          todayStart
        ),
      })),
    }));

    officeRows = officeStaff.map((u) => ({
      userId: u.id,
      name: u.name,
      position: u.position ?? "—",
      department: u.department ?? "",
      summary: summarize(
        weekAttendance.filter((r) => r.userId === u.id),
        todayStart
      ),
    }));
  }

  const summaryTable = (
    rows: { userId: string; name: string; position: string; summary: ReturnType<typeof summarize>; department?: string }[],
    showDept = false
  ) => (
    <Table>
      <thead>
        <tr>
          <Th>Name</Th>
          <Th>Position</Th>
          {showDept && <Th>Dept</Th>}
          <Th>Status today</Th>
          <Th className="text-right">Hours today</Th>
          <Th className="text-right">Hours (7 days)</Th>
          {canManagePersonnel && <Th />}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.userId} className={!r.summary.loggedToday ? "bg-red-50/40" : ""}>
            <Td className="font-medium">{r.name}</Td>
            <Td className="text-ink-600">{r.position}</Td>
            {showDept && <Td className="text-xs text-ink-500">{r.department}</Td>}
            <Td>
              <StatusCell open={r.summary.open} loggedToday={r.summary.loggedToday} />
            </Td>
            <Td className="text-right tabular-nums">{r.summary.todayHours.toFixed(1)}</Td>
            <Td className="text-right tabular-nums">{r.summary.weekHours.toFixed(1)}</Td>
            {canManagePersonnel && (
              <Td className="text-right">
                <RemovePersonnelButton userId={r.userId} name={r.name} />
              </Td>
            )}
          </tr>
        ))}
        {rows.length === 0 && (
          <tr>
            <Td colSpan={canManagePersonnel ? 7 : 6} className="py-6 text-center text-ink-400">
              No personnel here yet.
            </Td>
          </tr>
        )}
      </tbody>
    </Table>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink-900">Time &amp; Attendance</h1>
          {isAdmin && (
            <p className="text-sm text-ink-500">
              Hours below feed the Payroll tab automatically — site workers per project, office
              staff and drivers separately.
            </p>
          )}
        </div>
        {canManagePersonnel && <AddPersonnelSection projects={projects} />}
      </div>

      {/* Personal time clock */}
      <Card className="mx-auto max-w-xl lg:mx-0">
        <CardHeader
          title="My time clock"
          subtitle={
            openEntry ? `Clocked in since ${fmtDateTime(openEntry.timeIn)}` : "Not clocked in"
          }
        />
        <CardBody>
          <AttendanceClock projects={projects} clockedIn={!!openEntry} needsProject={needsProject} />
        </CardBody>
      </Card>

      {/* Admin summaries */}
      {isAdmin && (
        <>
          {siteSections.map((s) => (
            <Card key={s.projectId}>
              <CardHeader
                title={`Site workers — ${s.projectName} (${s.rows.length})`}
                subtitle="Roster from the project's payroll assignment; hours counted on this project only"
              />
              {summaryTable(s.rows)}
            </Card>
          ))}
          {siteSections.length === 0 && (
            <Card>
              <CardBody className="text-sm text-ink-400">
                No site rosters yet — assign workers to a project in the Payroll tab.
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader
              title={`Office workers & drivers (${officeRows.length})`}
              subtitle="Staff without a project — office admin, purchasing, accounting, drivers"
            />
            {summaryTable(officeRows, true)}
          </Card>
        </>
      )}

      {/* Own history */}
      <Card className="mx-auto max-w-xl lg:mx-0">
        <CardHeader title="My recent entries" subtitle="Your own record — payroll uses these" />
        <Table>
          <thead>
            <tr>
              <Th>Time in</Th>
              <Th>Time out</Th>
              <Th>Site</Th>
            </tr>
          </thead>
          <tbody>
            {recent.map((a) => (
              <tr key={a.id}>
                <Td className="text-xs">{fmtDateTime(a.timeIn)}</Td>
                <Td className="text-xs">{a.timeOut ? fmtDateTime(a.timeOut) : "— open —"}</Td>
                <Td className="text-xs">{a.project?.name ?? "Office"}</Td>
              </tr>
            ))}
            {recent.length === 0 && (
              <tr>
                <Td colSpan={3} className="py-6 text-center text-ink-400">
                  No entries yet — tap Time In to start.
                </Td>
              </tr>
            )}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
