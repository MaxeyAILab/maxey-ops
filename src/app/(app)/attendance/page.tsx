import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { Card, CardBody, CardHeader, Table, Td, Th } from "@/components/ui";
import { AttendanceClock } from "@/components/attendance-clock";
import {
  AddPersonnelSection,
  EditPersonnelButton,
  RemovePersonnelButton,
} from "@/components/personnel-actions";
import {
  DecideTimeAdjustmentButtons,
  RequestTimeAdjustmentButton,
  RequestWeekendWorkButton,
  type PendingTimeAdjustment,
} from "@/components/time-adjustment-actions";
import { CHARGEABLE_STATUSES } from "@/lib/project-status";
import { fetchApprovals } from "@/lib/payroll";
import {
  computeEffectiveHours,
  isEarlyStart,
  isOvertime,
  isWeekendRestrictedDepartment,
  rulesetForDepartment,
  type AdjustmentFlags,
  type TimeRuleset,
} from "@/lib/time-rules";
import type { Attendance, Role } from "@prisma/client";

export const metadata = { title: "Attendance" };
export const dynamic = "force-dynamic";

const timeFmt = new Intl.DateTimeFormat("en-PH", {
  timeZone: "Asia/Manila",
  hour: "numeric",
  minute: "2-digit",
});

function summarize(
  records: Attendance[],
  todayStart: Date,
  ruleset: TimeRuleset,
  approvals: Map<string, AdjustmentFlags>
) {
  const open = records.find((r) => r.timeOut === null);
  const completed = records.filter((r) => r.timeOut !== null);
  const hours = (rs: Attendance[]) =>
    rs.reduce((s, r) => s + computeEffectiveHours(r.timeIn, r.timeOut!, ruleset, approvals.get(r.id)), 0);
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

  // Buddy-punching signal: the same browser (deviceId) tapping IN for more
  // than one distinct person this week is worth a human look — not proof of
  // anything by itself (a shared office tablet would also trigger this),
  // just a flag.
  let sharedDeviceWarnings: { deviceId: string; names: string[] }[] = [];

  // Admin summary data
  let siteSections: {
    projectId: string;
    projectName: string;
    rows: {
      userId: string;
      name: string;
      position: string;
      dailyRate: number | null;
      phone: string | null;
      email: string | null;
      role: Role;
      useCustomMenus: boolean;
      customMenus: string[];
      summary: ReturnType<typeof summarize>;
    }[];
  }[] = [];
  let officeRows: {
    userId: string;
    name: string;
    position: string;
    department: string;
    dailyRate: number | null;
    phone: string | null;
    email: string | null;
    role: Role;
    useCustomMenus: boolean;
    customMenus: string[];
    summary: ReturnType<typeof summarize>;
  }[] = [];
  // Site workers hired ahead of a project (Add personnel → project "TBA") —
  // no ProjectAssignment yet, so they'd otherwise never appear anywhere:
  // excluded from every project roster (no assignment) and from the office
  // list below (department is SITE, not OFFICE/DRIVER).
  let tbaRows: typeof officeRows = [];

  if (isAdmin) {
    const [rosters, officeStaff, tbaWorkers, weekAttendance] = await Promise.all([
      prisma.project.findMany({
        where: { status: { in: CHARGEABLE_STATUSES }, assignments: { some: { active: true } } },
        orderBy: { name: "asc" },
        include: {
          assignments: {
            where: { active: true },
            orderBy: { user: { name: "asc" } },
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  position: true,
                  department: true,
                  dailyRate: true,
                  phone: true,
                  email: true,
                  role: true,
                  useCustomMenus: true,
                  customMenus: true,
                },
              },
            },
          },
        },
      }),
      prisma.user.findMany({
        where: {
          active: true,
          role: { not: "CLIENT" },
          department: { in: ["OFFICE", "DRIVER", "ARCHITECT", "ENGINEER"] },
        },
        orderBy: [{ department: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          position: true,
          department: true,
          dailyRate: true,
          phone: true,
          email: true,
          role: true,
          useCustomMenus: true,
          customMenus: true,
        },
      }),
      prisma.user.findMany({
        where: {
          active: true,
          department: "SITE",
          assignments: { none: { active: true } },
        },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          position: true,
          dailyRate: true,
          phone: true,
          email: true,
          role: true,
          useCustomMenus: true,
          customMenus: true,
        },
      }),
      prisma.attendance.findMany({
        where: { OR: [{ timeIn: { gte: weekStart } }, { timeOut: null }] },
      }),
    ]);
    const weekApprovals = await fetchApprovals(weekAttendance);

    siteSections = rosters.map((p) => ({
      projectId: p.id,
      projectName: p.name,
      rows: p.assignments.map((a) => ({
        userId: a.user.id,
        name: a.user.name,
        position: a.user.position ?? "—",
        department: a.user.department ?? "SITE",
        dailyRate: a.user.dailyRate ? Number(a.user.dailyRate) : null,
        phone: a.user.phone,
        email: a.user.email,
        role: a.user.role,
        useCustomMenus: a.user.useCustomMenus,
        customMenus: a.user.customMenus,
        summary: summarize(
          weekAttendance.filter((r) => r.userId === a.userId && r.projectId === p.id),
          todayStart,
          "SITE",
          weekApprovals
        ),
      })),
    }));

    officeRows = officeStaff.map((u) => ({
      userId: u.id,
      name: u.name,
      position: u.position ?? "—",
      department: u.department ?? "",
      dailyRate: u.dailyRate ? Number(u.dailyRate) : null,
      phone: u.phone,
      email: u.email,
      role: u.role,
      useCustomMenus: u.useCustomMenus,
      customMenus: u.customMenus,
      summary: summarize(
        weekAttendance.filter((r) => r.userId === u.id),
        todayStart,
        rulesetForDepartment(u.department),
        weekApprovals
      ),
    }));

    tbaRows = tbaWorkers.map((u) => ({
      userId: u.id,
      name: u.name,
      position: u.position ?? "—",
      department: "SITE", // real value for the edit form; displayed as "TBA" since they have no roster yet
      dailyRate: u.dailyRate ? Number(u.dailyRate) : null,
      phone: u.phone,
      email: u.email,
      role: u.role,
      useCustomMenus: u.useCustomMenus,
      customMenus: u.customMenus,
      summary: summarize(
        weekAttendance.filter((r) => r.userId === u.id),
        todayStart,
        "SITE",
        weekApprovals
      ),
    }));

    const deviceUsers = new Map<string, Set<string>>();
    for (const a of weekAttendance) {
      if (!a.deviceIdIn) continue;
      if (!deviceUsers.has(a.deviceIdIn)) deviceUsers.set(a.deviceIdIn, new Set());
      deviceUsers.get(a.deviceIdIn)!.add(a.userId);
    }
    const sharedDeviceGroups = Array.from(deviceUsers.entries()).filter(([, u]) => u.size > 1);
    if (sharedDeviceGroups.length > 0) {
      const involvedIds = Array.from(new Set(sharedDeviceGroups.flatMap(([, u]) => Array.from(u))));
      const involvedUsers = await prisma.user.findMany({
        where: { id: { in: involvedIds } },
        select: { id: true, name: true },
      });
      const nameOf = new Map(involvedUsers.map((u) => [u.id, u.name]));
      sharedDeviceWarnings = sharedDeviceGroups.map(([deviceId, users]) => ({
        deviceId,
        names: Array.from(users).map((id) => nameOf.get(id) ?? "Unknown"),
      }));
    }
  }

  // Early-start/overtime requests: who can decide (Owner/PM — narrower than
  // the isAdmin summary view above, which also includes Accounting), and
  // what the current user has already filed on their own recent entries.
  const canDecideAdjustments = ["OWNER", "PM"].includes(user.role);
  let pendingAdjustments: PendingTimeAdjustment[] = [];
  if (canDecideAdjustments) {
    const pending = await prisma.timeAdjustmentRequest.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
      include: {
        user: { select: { name: true } },
        requestedBy: { select: { name: true } },
        attendance: true,
      },
    });
    pendingAdjustments = pending.map((r) => ({
      id: r.id,
      employeeName: r.user.name,
      type: r.type,
      reason: r.reason,
      shiftLabel:
        r.type === "WEEKEND_WORK"
          ? fmtDate(r.date!)
          : r.type === "EARLY_START"
            ? fmtDateTime(r.attendance!.timeIn)
            : fmtDateTime(r.attendance!.timeOut ?? r.attendance!.timeIn),
      requestedByName: r.requestedBy.name,
    }));
  }

  const myRuleset = rulesetForDepartment(me?.department);
  const iAmWeekendRestricted = isWeekendRestrictedDepartment(me?.department);
  const [myRequests, myWeekendRequests] = await Promise.all([
    prisma.timeAdjustmentRequest.findMany({
      where: { attendanceId: { in: recent.map((a) => a.id) } },
    }),
    iAmWeekendRestricted
      ? prisma.timeAdjustmentRequest.findMany({
          where: { userId: user.id, type: "WEEKEND_WORK" },
          orderBy: { createdAt: "desc" },
          take: 5,
        })
      : Promise.resolve([]),
  ]);
  const myRequestStatus = (attendanceId: string, type: "EARLY_START" | "OVERTIME") =>
    myRequests.find((r) => r.attendanceId === attendanceId && r.type === type)?.status;

  const summaryTable = (
    rows: {
      userId: string;
      name: string;
      position: string;
      dailyRate: number | null;
      phone: string | null;
      email: string | null;
      role: Role;
      useCustomMenus: boolean;
      customMenus: string[];
      summary: ReturnType<typeof summarize>;
      department?: string;
    }[],
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
            {showDept && (
              <Td className="text-xs text-ink-500">{r.department === "SITE" ? "TBA" : r.department}</Td>
            )}
            <Td>
              <StatusCell open={r.summary.open} loggedToday={r.summary.loggedToday} />
            </Td>
            <Td className="text-right tabular-nums">{r.summary.todayHours.toFixed(1)}</Td>
            <Td className="text-right tabular-nums">{r.summary.weekHours.toFixed(1)}</Td>
            {canManagePersonnel && (
              <Td className="text-right whitespace-nowrap">
                <EditPersonnelButton
                  userId={r.userId}
                  name={r.name}
                  position={r.position}
                  department={r.department}
                  dailyRate={r.dailyRate}
                  phone={r.phone}
                  email={r.email}
                  role={r.role}
                  useCustomMenus={r.useCustomMenus}
                  customMenus={r.customMenus}
                />
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

      {isAdmin && sharedDeviceWarnings.length > 0 && (
        <Card className="border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/30">
          <CardHeader
            title={`⚠ ${sharedDeviceWarnings.length} device${sharedDeviceWarnings.length === 1 ? "" : "s"} shared across staff this week`}
            subtitle="The same browser/device tapped Time In for more than one person — not proof of anything (a shared office tablet triggers this too), just worth a look"
          />
          <CardBody className="space-y-1.5 text-sm">
            {sharedDeviceWarnings.map((w) => (
              <p key={w.deviceId} className="text-red-700">
                <span className="font-medium">{w.names.join(" & ")}</span> tapped in from the
                same device this week
              </p>
            ))}
          </CardBody>
        </Card>
      )}

      {canDecideAdjustments && pendingAdjustments.length > 0 && (
        <Card className="border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/30">
          <CardHeader
            title={`${pendingAdjustments.length} time-adjustment request${pendingAdjustments.length === 1 ? "" : "s"} awaiting your decision`}
            subtitle="Approving lifts the clamp for that shift/day; rejecting leaves it as-is — the original clock-in/out record is never changed either way"
          />
          <CardBody className="space-y-3">
            {pendingAdjustments.map((r) => (
              <div key={r.id} className="rounded-lg border border-ink-100 bg-white p-3 text-sm dark:bg-transparent">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-ink-900">
                    {r.employeeName} —{" "}
                    {r.type === "EARLY_START" ? "Early start" : r.type === "OVERTIME" ? "Overtime" : "Weekend work"} ·{" "}
                    {r.shiftLabel}
                  </span>
                  <span className="text-xs text-ink-400">requested by {r.requestedByName}</span>
                </div>
                <p className="mt-1 text-xs text-ink-600">{r.reason}</p>
                <div className="mt-2">
                  <DecideTimeAdjustmentButtons request={r} />
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      )}

      {/* Personal time clock */}
      <Card className="mx-auto max-w-xl lg:mx-0">
        <CardHeader
          title="My time clock"
          subtitle={
            openEntry ? `Clocked in since ${fmtDateTime(openEntry.timeIn)}` : "Not clocked in"
          }
        />
        <CardBody className="space-y-4">
          <AttendanceClock projects={projects} clockedIn={!!openEntry} needsProject={needsProject} />
          {iAmWeekendRestricted && (
            <div className="rounded-lg border border-ink-100 p-3">
              <p className="text-xs text-ink-500">
                Office/driver accounts are clocked out automatically at 5pm Saturday and can&apos;t
                clock in on Sunday. Need to work one of those days? Request approval first.
              </p>
              {myWeekendRequests.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs text-ink-600">
                  {myWeekendRequests.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-2">
                      <span>{fmtDate(r.date!)}</span>
                      <span
                        className={
                          r.status === "APPROVED"
                            ? "font-medium text-emerald-600"
                            : r.status === "REJECTED"
                              ? "font-medium text-red-600"
                              : "font-medium text-amber-600"
                        }
                      >
                        {r.status}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-2">
                <RequestWeekendWorkButton />
              </div>
            </div>
          )}
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

          {tbaRows.length > 0 && (
            <Card>
              <CardHeader
                title={`Unassigned (TBA) site workers (${tbaRows.length})`}
                subtitle="Hired ahead of a project — clock in/out is tracked here until assigned to one in the Payroll tab"
              />
              {summaryTable(tbaRows, true)}
            </Card>
          )}

          <Card>
            <CardHeader
              title={`Office, drivers & professional staff (${officeRows.length})`}
              subtitle="Staff without a project — office admin, purchasing, accounting, drivers, architects, engineers"
            />
            {summaryTable(officeRows, true)}
          </Card>
        </>
      )}

      {/* Own history */}
      <Card className="mx-auto max-w-xl lg:mx-0">
        <CardHeader
          title="My recent entries"
          subtitle="Your own record — payroll counts these against the standard schedule (clamped start, breaks, 5pm cutoff) unless a request below is approved"
        />
        <Table>
          <thead>
            <tr>
              <Th>Time in</Th>
              <Th>Time out</Th>
              <Th>Site</Th>
              <Th>Device</Th>
              <Th>Adjustments</Th>
            </tr>
          </thead>
          <tbody>
            {recent.map((a) => {
              const earlyStatus = myRequestStatus(a.id, "EARLY_START");
              const otStatus = myRequestStatus(a.id, "OVERTIME");
              const showEarly = isEarlyStart(a.timeIn, myRuleset);
              const showOt = a.timeOut && isOvertime(a.timeOut);
              return (
                <tr key={a.id}>
                  <Td className="text-xs">{fmtDateTime(a.timeIn)}</Td>
                  <Td className="text-xs">{a.timeOut ? fmtDateTime(a.timeOut) : "— open —"}</Td>
                  <Td className="text-xs">{a.project?.name ?? "Office"}</Td>
                  <Td className="text-xs text-ink-500">{a.deviceIn ?? "—"}</Td>
                  <Td className="text-xs">
                    <div className="flex flex-col items-start gap-1">
                      {showEarly && (
                        <RequestTimeAdjustmentButton
                          attendanceId={a.id}
                          type="EARLY_START"
                          label="Request early-start credit"
                          existingStatus={earlyStatus}
                        />
                      )}
                      {showOt && (
                        <RequestTimeAdjustmentButton
                          attendanceId={a.id}
                          type="OVERTIME"
                          label="Request overtime credit"
                          existingStatus={otStatus}
                        />
                      )}
                      {!showEarly && !showOt && "—"}
                    </div>
                  </Td>
                </tr>
              );
            })}
            {recent.length === 0 && (
              <tr>
                <Td colSpan={5} className="py-6 text-center text-ink-400">
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
