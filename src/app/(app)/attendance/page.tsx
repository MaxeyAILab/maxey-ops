import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { Card, CardBody, CardHeader, Table, Td, Th } from "@/components/ui";
import { AttendanceCrewBoard, type CrewFilter, type CrewSection, type CrewStatus } from "@/components/attendance-crew-board";
import { AttendanceClock } from "@/components/attendance-clock";
import {
  AddPersonnelSection,
  EditPersonnelButton,
  RemovePersonnelButton,
} from "@/components/personnel-actions";
import {
  DecideTimeAdjustmentButtons,
  EditApprovedHours,
  type ApprovedHoursRow,
  RequestTimeAdjustmentButton,
  RequestWeekendWorkButton,
  type PendingTimeAdjustment,
} from "@/components/time-adjustment-actions";
import { LocationPin } from "@/components/location-pin";
import { ForceTimeOutButton } from "@/components/force-timeout-button";
import { defaultForcedTimeOut } from "@/lib/force-timeout";
import { EditPeriodTotalButton, EditTodayHoursButton } from "@/components/hours-override-button";
import { CHARGEABLE_STATUSES } from "@/lib/project-status";
import { payslipPeriodLabel } from "@/lib/payslip";
import { canOpenTimesheets } from "@/lib/timesheet";
import { computeDailyHoursByDay, fetchApprovals, fetchDailyOverrides, withLiveOpenShifts } from "@/lib/payroll";
import {
  isEarlyStart,
  isOvertime,
  isWeekendRestrictedDepartment,
  manilaDayKey,
  manilaSemiMonthlyPeriod,
  manilaWeeklySitePeriod,
  claimedExtraHours,
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

const sinceFmt = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

interface PayPeriod {
  start: Date;
  end: Date;
  label: string;
}

/** Today's hours plus the running total for the employee's current pay period
 * (semi-monthly for office staff, Friday-to-Friday weekly for drivers/site),
 * including the Owner's period-total correction, if any. A shift still in
 * progress counts live up to now. */
function summarize(
  userId: string,
  records: Attendance[],
  todayStart: Date,
  ruleset: TimeRuleset,
  approvals: Map<string, AdjustmentFlags>,
  overrides: Map<string, number>,
  period: PayPeriod,
  adjustment: number,
  projectId: string | null
) {
  const open = records.find((r) => r.timeOut === null);
  const completed = records.filter((r) => r.timeOut !== null);
  const todayKey = manilaDayKey(todayStart);
  const live = withLiveOpenShifts(records);
  const todayHours = computeDailyHoursByDay(userId, live, ruleset, approvals, overrides).get(todayKey) ?? 0;
  const periodRecords = live.filter((r) => r.timeIn >= period.start && r.timeIn <= period.end);
  const periodByDay = computeDailyHoursByDay(userId, periodRecords, ruleset, approvals, overrides);
  const periodBase = Array.from(periodByDay.values()).reduce((s, h) => s + h, 0);
  const periodHours = Math.max(0, periodBase + adjustment);
  const loggedToday = !!open || completed.some((r) => r.timeIn >= todayStart);
  return { open, todayHours, periodHours, periodLabel: period.label, projectId, loggedToday };
}

function initials(name: string) {
  const parts = name.replace(/^(DEMO|Engr\.?|Arch\.?)\s+/i, "").trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
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
      <span className="fx-ok inline-flex items-center gap-1.5 text-xs font-semibold">
        <span className="fx-live" />
        On duty since {manilaDayKey(open.timeIn) === manilaDayKey(new Date()) ? timeFmt.format(open.timeIn) : sinceFmt.format(open.timeIn)}
      </span>
    );
  }
  if (loggedToday) {
    return <span className="text-xs font-semibold text-brand-600">✓ Logged today</span>;
  }
  return <span className="text-xs font-semibold text-accent">● Not logged in</span>;
}

type Tab = "today" | "requests" | "approved" | "mine";

export default async function AttendancePage({ searchParams }: { searchParams: { tab?: string; show?: string } }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role === "CLIENT") redirect("/portal");

  const isAdmin = ["OWNER", "ACCOUNTING", "PM"].includes(user.role);
  const canManagePersonnel = user.role === "OWNER"; // only the Owner creates/removes accounts

  // Manila day boundaries (payroll uses the same anchoring)
  const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
  const todayStart = new Date(`${todayStr}T00:00:00.000+08:00`);
  const weekStart = new Date(todayStart.getTime() - 6 * 86_400_000);
  const now = new Date();
  const semiPeriod = manilaSemiMonthlyPeriod(now);
  const weeklyPeriod = manilaWeeklySitePeriod(now);
  const fetchStart = new Date(Math.min(weekStart.getTime(), semiPeriod.start.getTime(), weeklyPeriod.start.getTime()));
  const periodFor = (department: string | null | undefined): PayPeriod =>
    department === "SITE" || department === "DRIVER" ? weeklyPeriod : semiPeriod;

  const [me, openEntry, recentAll, projects] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.id } }),
    prisma.attendance.findFirst({
      where: { userId: user.id, timeOut: null },
      orderBy: { timeIn: "desc" },
      include: { project: { select: { name: true } } },
    }),
    // the person's whole current pay cut-off (never fewer than their latest 10 punches), so nothing from the start of the
    // period drops off the list — the same days payroll will count
    prisma.attendance.findMany({
      where: { userId: user.id },
      orderBy: { timeIn: "desc" },
      take: 300,
      include: { project: { select: { name: true } } },
    }),
    prisma.project.findMany({
      where: { status: { in: CHARGEABLE_STATUSES } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const myPeriod = periodFor(user.department);
  const recent = recentAll.filter((a, i) => i < 10 || a.timeIn >= myPeriod.start);

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
      employeeNo?: string | null;
      dailyRate: number | null;
      phone: string | null;
      email: string | null;
      role: Role;
      jobRole: string | null;
      useCustomMenus: boolean;
      customMenus: string[];
      summary: ReturnType<typeof summarize>;
    }[];
  }[] = [];
  let officeRows: {
    userId: string;
    name: string;
    position: string;
    employeeNo?: string | null;
    department: string;
    dailyRate: number | null;
    monthlySalary: number | null;
    phone: string | null;
    email: string | null;
    role: Role;
    jobRole: string | null;
    useCustomMenus: boolean;
    customMenus: string[];
    summary: ReturnType<typeof summarize>;
  }[] = [];
  // Site workers hired ahead of a project (Add personnel → project "TBA") —
  // no ProjectAssignment yet, so they'd otherwise never appear anywhere:
  // excluded from every project roster (no assignment) and from the office
  // list below (department is SITE, not OFFICE/DRIVER).
  let tbaRows: typeof officeRows = [];
  // every active roster a person is on (a person can be on several projects) and the projects the Owner can put people on
  const assignedByUser = new Map<string, string[]>();
  let projectChoices: { id: string; name: string }[] = [];

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
          employeeNo: true,
                  department: true,
                  dailyRate: true,
                  phone: true,
                  email: true,
                  role: true,
                  jobRole: true,
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
          employeeNo: true,
          department: true,
          dailyRate: true,
          monthlySalary: true,
          phone: true,
          email: true,
          role: true,
          jobRole: true,
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
          employeeNo: true,
          dailyRate: true,
          phone: true,
          email: true,
          role: true,
          jobRole: true,
          useCustomMenus: true,
          customMenus: true,
        },
      }),
      prisma.attendance.findMany({
        where: { OR: [{ timeIn: { gte: fetchStart } }, { timeOut: null }] },
      }),
    ]);
    if (user.role === "OWNER") {
      const [activeAssignments, choosable] = await Promise.all([
        prisma.projectAssignment.findMany({ where: { active: true }, select: { userId: true, project: { select: { id: true, name: true } } } }),
        prisma.project.findMany({ where: { status: { in: CHARGEABLE_STATUSES } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
      ]);
      const byId = new Map(choosable.map((p) => [p.id, p]));
      for (const a of activeAssignments) {
        assignedByUser.set(a.userId, [...(assignedByUser.get(a.userId) ?? []), a.project.id]);
        if (!byId.has(a.project.id)) byId.set(a.project.id, a.project); // a project they are on stays in the list even if it is no longer active
      }
      projectChoices = [...byId.values()].sort((x, y) => x.name.localeCompare(y.name));
    }
    const allUserIds = Array.from(
      new Set([
        ...weekAttendance.map((a) => a.userId),
        ...rosters.flatMap((p) => p.assignments.map((a) => a.user.id)),
        ...officeStaff.map((u) => u.id),
        ...tbaWorkers.map((u) => u.id),
      ])
    );
    const [weekApprovals, weekOverrides, adjustmentRows] = await Promise.all([
      fetchApprovals(weekAttendance),
      fetchDailyOverrides(allUserIds, fetchStart, new Date()),
      prisma.periodHoursAdjustment.findMany({
        where: { periodStart: { in: [semiPeriod.start, weeklyPeriod.start] } },
      }),
    ]);
    const adjustmentFor = (userId: string, projectId: string, period: PayPeriod) =>
      Number(
        adjustmentRows.find(
          (r) =>
            r.userId === userId &&
            r.projectId === projectId &&
            r.periodStart.getTime() === period.start.getTime()
        )?.deltaHours ?? 0
      );

    siteSections = rosters.map((p) => ({
      projectId: p.id,
      projectName: p.name,
      rows: p.assignments.map((a) => ({
        userId: a.user.id,
        name: a.user.name,
        position: a.user.position ?? "—",
        employeeNo: a.user.employeeNo,
        department: a.user.department ?? "SITE",
        dailyRate: a.user.dailyRate ? Number(a.user.dailyRate) : null,
        phone: a.user.phone,
        email: a.user.email,
        role: a.user.role,
        jobRole: a.user.jobRole,
        useCustomMenus: a.user.useCustomMenus,
        customMenus: a.user.customMenus,
        summary: summarize(
          a.user.id,
          weekAttendance.filter((r) => r.userId === a.userId && r.projectId === p.id),
          todayStart,
          "SITE",
          weekApprovals,
          weekOverrides,
          weeklyPeriod,
          adjustmentFor(a.user.id, p.id, weeklyPeriod),
          p.id
        ),
      })),
    }));

    officeRows = officeStaff.map((u) => ({
      userId: u.id,
      name: u.name,
      position: u.position ?? "—",
      employeeNo: u.employeeNo,
      department: u.department ?? "",
      dailyRate: u.dailyRate ? Number(u.dailyRate) : null,
      monthlySalary: u.monthlySalary ? Number(u.monthlySalary) : null,
      phone: u.phone,
      email: u.email,
      role: u.role,
      jobRole: u.jobRole,
      useCustomMenus: u.useCustomMenus,
      customMenus: u.customMenus,
      summary: summarize(
        u.id,
        weekAttendance.filter((r) => r.userId === u.id),
        todayStart,
        rulesetForDepartment(u.department),
        weekApprovals,
        weekOverrides,
        periodFor(u.department),
        adjustmentFor(u.id, "", periodFor(u.department)),
        null
      ),
    }));

    tbaRows = tbaWorkers.map((u) => ({
      userId: u.id,
      name: u.name,
      position: u.position ?? "—",
      employeeNo: u.employeeNo,
      department: "SITE", // real value for the edit form; displayed as "TBA" since they have no roster yet
      dailyRate: u.dailyRate ? Number(u.dailyRate) : null,
      monthlySalary: null,
      phone: u.phone,
      email: u.email,
      role: u.role,
      jobRole: u.jobRole,
      useCustomMenus: u.useCustomMenus,
      customMenus: u.customMenus,
      summary: summarize(
        u.id,
        weekAttendance.filter((r) => r.userId === u.id),
        todayStart,
        "SITE",
        weekApprovals,
        weekOverrides,
        weeklyPeriod,
        adjustmentFor(u.id, "", weeklyPeriod),
        null
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
        user: { select: { name: true, department: true } },
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
      gpsIn: r.attendance?.gpsIn ?? null,
      gpsOut: r.attendance?.gpsOut ?? null,
      claimedHours: r.attendance && r.type !== "WEEKEND_WORK" ? claimedExtraHours(r.type, r.attendance.timeIn, r.attendance.timeOut, rulesetForDepartment(r.user.department)) : null,
      clockLabel: r.attendance ? `In ${timeFmt.format(r.attendance.timeIn)} → out ${r.attendance.timeOut ? timeFmt.format(r.attendance.timeOut) : "not yet"}` : null,
    }));
  }

  // The Owner can still change the hours credited on a request approved in the last 30 days.
  let approvedHours: ApprovedHoursRow[] = [];
  if (user.role === "OWNER") {
    const since = new Date(Date.now() - 30 * 24 * 3600_000);
    const approved = await prisma.timeAdjustmentRequest.findMany({
      where: { status: "APPROVED", type: { in: ["OVERTIME", "EARLY_START"] }, decidedAt: { gte: since } },
      orderBy: { decidedAt: "desc" },
      include: { user: { select: { name: true, department: true } }, attendance: true },
    });
    approvedHours = approved.flatMap((r) => {
      if (!r.attendance || (r.type !== "OVERTIME" && r.type !== "EARLY_START")) return [];
      const claimed = claimedExtraHours(r.type, r.attendance.timeIn, r.attendance.timeOut, rulesetForDepartment(r.user.department));
      if (claimed <= 0) return [];
      return [
        {
          id: r.id,
          employeeName: r.user.name,
          type: r.type,
          shiftLabel: fmtDate(r.attendance.timeIn),
          clockLabel: `In ${timeFmt.format(r.attendance.timeIn)} → out ${r.attendance.timeOut ? timeFmt.format(r.attendance.timeOut) : "not yet"}`,
          claimedHours: claimed,
          creditedHours: r.approvedHours === null ? claimed : Number(r.approvedHours),
        },
      ];
    });
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

  type SummaryRow = {
    userId: string;
    name: string;
    position: string;
    employeeNo?: string | null;
    dailyRate: number | null;
    monthlySalary?: number | null;
    phone: string | null;
    email: string | null;
    role: Role;
    jobRole: string | null;
    useCustomMenus: boolean;
    customMenus: string[];
    summary: ReturnType<typeof summarize>;
    department?: string;
  };

  const todayKey = manilaDayKey(now);
  const statusOf = (r: SummaryRow): CrewStatus =>
    r.summary.open
      ? manilaDayKey(r.summary.open.timeIn) === todayKey
        ? "in"
        : "stale"
      : r.summary.loggedToday
        ? "done"
        : "none";

  const tableHeader = (showDept: boolean) => (
    <thead>
      <tr>
        <Th>Name</Th>
        <Th>Position</Th>
        {showDept && <Th>Dept</Th>}
        <Th>Status today</Th>
        <Th className="text-right">Hours today</Th>
        <Th className="text-right">Hours (pay period)</Th>
        {canManagePersonnel && <Th />}
      </tr>
    </thead>
  );

  const tableRow = (r: SummaryRow, showDept: boolean) => (
    <tr className={!r.summary.loggedToday ? "bg-accent/[0.05]" : ""}>
      <Td className="font-semibold">
        <span className="flex items-center gap-2.5">
          <span aria-hidden className="fx-avatar flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-500 text-[10px] font-bold text-white">
            {initials(r.name)}
          </span>
          {r.name}
        </span>
      </Td>
      <Td className="text-ink-600">{r.position}</Td>
      {showDept && <Td className="text-xs text-ink-500">{r.department === "SITE" ? "TBA" : r.department}</Td>}
      <Td>
        <StatusCell open={r.summary.open} loggedToday={r.summary.loggedToday} />
        {canManagePersonnel && r.summary.open && (
          <ForceTimeOutButton
            attendanceId={r.summary.open.id}
            name={r.name}
            since={sinceFmt.format(r.summary.open.timeIn)}
            defaultTime={defaultForcedTimeOut(r.summary.open.timeIn, now)}
          />
        )}
      </Td>
      <Td className="relative text-right font-mono">
        {r.summary.todayHours.toFixed(1)}
        {canManagePersonnel && <EditTodayHoursButton userId={r.userId} currentHours={r.summary.todayHours} />}
      </Td>
      <Td className="relative text-right font-mono">
        {r.summary.periodHours.toFixed(1)}
        {canManagePersonnel && (
          <EditPeriodTotalButton
            userId={r.userId}
            projectId={r.summary.projectId}
            currentTotal={r.summary.periodHours}
            periodLabel={r.summary.periodLabel}
          />
        )}
        <div className="text-[10px] font-normal text-ink-400">{r.summary.periodLabel}</div>
      </Td>
      {canManagePersonnel && (
        <Td className="text-right whitespace-nowrap">
          <EditPersonnelButton
            userId={r.userId}
            name={r.name}
            position={r.position}
            employeeNo={r.employeeNo}
            department={r.department}
            dailyRate={r.dailyRate}
            monthlySalary={r.monthlySalary}
            phone={r.phone}
            email={r.email}
            role={r.role}
            jobRole={r.jobRole}
            useCustomMenus={r.useCustomMenus}
            customMenus={r.customMenus}
            projects={projectChoices}
            assignedProjectIds={assignedByUser.get(r.userId) ?? []}
          />
          <RemovePersonnelButton userId={r.userId} name={r.name} />
        </Td>
      )}
    </tr>
  );

  const crewSection = (key: string, title: string, subtitle: string, rows: SummaryRow[], showDept: boolean): CrewSection => ({
    key,
    title,
    subtitle,
    header: tableHeader(showDept),
    rows: rows.map((r) => ({
      key: `${key}:${r.userId}`,
      name: r.name,
      position: r.position,
      status: statusOf(r),
      row: tableRow(r, showDept),
    })),
  });

  const crewSections: CrewSection[] = isAdmin
    ? [
        ...siteSections.map((s) =>
          crewSection(`p-${s.projectId}`, s.projectName, "Site workers — roster from the project's payroll assignment; hours counted on this project only", s.rows, false)
        ),
        ...(tbaRows.length > 0
          ? [crewSection("tba", "Unassigned (TBA) site workers", "Hired ahead of a project — tracked here until assigned to one in the Payroll tab", tbaRows, true)]
          : []),
        crewSection("office", "Office, drivers & professional staff", "Office admin, purchasing, accounting, drivers, architects, engineers", officeRows, true),
      ]
    : [];

  // Today at a glance — each person counted once even if they are on several rosters (best status wins)
  const rank: Record<CrewStatus, number> = { in: 3, done: 2, stale: 1, none: 0 };
  const people = new Map<string, { status: CrewStatus; hours: number }>();
  for (const r of [...siteSections.flatMap((s) => s.rows), ...tbaRows, ...officeRows] as SummaryRow[]) {
    const st = statusOf(r);
    const prev = people.get(r.userId);
    people.set(r.userId, {
      status: !prev || rank[st] > rank[prev.status] ? st : prev.status,
      hours: Math.max(prev?.hours ?? 0, r.summary.todayHours),
    });
  }
  const crew = Array.from(people.values());
  const kpi = {
    total: crew.length,
    present: crew.filter((p) => p.status === "in" || p.status === "done").length,
    onNow: crew.filter((p) => p.status === "in").length,
    stale: crew.filter((p) => p.status === "stale").length,
    manHours: crew.reduce((s, p) => s + p.hours, 0),
  };
  const notLogged = crew.filter((p) => p.status === "none").length;
  const groupsMissing = crewSections.filter((s) => s.rows.some((r) => r.status === "none")).length;

  // My own numbers for the clock strip
  const myLive = withLiveOpenShifts(recentAll);
  const [myApprovals, myOverrides, myAdjustments] = await Promise.all([
    fetchApprovals(recentAll),
    fetchDailyOverrides([user.id], myPeriod.start, new Date()),
    prisma.periodHoursAdjustment.findMany({ where: { userId: user.id, periodStart: myPeriod.start } }),
  ]);
  const myToday = computeDailyHoursByDay(user.id, myLive, myRuleset, myApprovals, myOverrides).get(todayKey) ?? 0;
  const myPeriodBase = Array.from(
    computeDailyHoursByDay(
      user.id,
      myLive.filter((r) => r.timeIn >= myPeriod.start && r.timeIn <= myPeriod.end),
      myRuleset,
      myApprovals,
      myOverrides
    ).values()
  ).reduce((a, h) => a + h, 0);
  const myPeriodHours = Math.max(0, myPeriodBase + myAdjustments.reduce((a, r) => a + Number(r.deltaHours), 0));

  // Tabs (managers only; everyone else sees their clock + entries)
  const tabs: { id: Tab; label: string; badge?: number }[] = isAdmin
    ? [
        { id: "today", label: "Today's crew" },
        ...(canDecideAdjustments ? [{ id: "requests" as Tab, label: "Requests", badge: pendingAdjustments.length }] : []),
        ...(user.role === "OWNER" ? [{ id: "approved" as Tab, label: "Approved OT (30 days)" }] : []),
        { id: "mine", label: "My entries" },
      ]
    : [];
  const tab: Tab = isAdmin ? (tabs.find((t) => t.id === searchParams.tab)?.id ?? "today") : "mine";
  const initialFilter: CrewFilter = (["none", "in", "done", "stale"] as const).find((f) => f === searchParams.show) ?? "all";

  const btn = "rounded-full border border-ink-200 bg-ink-50 px-3.5 py-1.5 text-xs font-semibold text-ink-700 hover:border-ink-400";

  const weekendBlock = iAmWeekendRestricted ? (
    <div className="rounded-lg border border-ink-100 p-3">
      <p className="text-xs text-ink-500">
        Office/driver accounts are clocked out automatically at 5pm Saturday and can&apos;t clock in on Sunday. Need to work
        one of those days? Request approval first.
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
  ) : null;

  const myEntries = (
    <Card>
      <CardHeader
        title={`My entries — this cut-off (${payslipPeriodLabel(myPeriod.start, myPeriod.end)})`}
        subtitle="Every punch of your current pay period, newest first. Your own record — payroll counts these against the standard schedule (clamped start, breaks, 5pm cutoff) unless a request below is approved"
      />
      <Table>
        <thead>
          <tr>
            <Th>Time in</Th>
            <Th>Time out</Th>
            <Th>Site</Th>
            <Th>Device</Th>
            <Th>Location</Th>
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
                    <LocationPin gps={a.gpsIn} label="In" />
                    {a.timeOut && a.gpsOut && <LocationPin gps={a.gpsOut} label="Out" />}
                  </div>
                </Td>
                <Td className="text-xs">
                  <div className="flex flex-col items-start gap-1">
                    {showEarly && (
                      <RequestTimeAdjustmentButton attendanceId={a.id} type="EARLY_START" label="Request early-start credit" existingStatus={earlyStatus} />
                    )}
                    {showOt && (
                      <RequestTimeAdjustmentButton attendanceId={a.id} type="OVERTIME" label="Request overtime credit" existingStatus={otStatus} />
                    )}
                    {!showEarly && !showOt && "—"}
                  </div>
                </Td>
              </tr>
            );
          })}
          {recent.length === 0 && (
            <tr>
              <Td colSpan={6} className="py-6 text-center text-ink-400">
                No entries yet — tap Time In to start.
              </Td>
            </tr>
          )}
        </tbody>
      </Table>
    </Card>
  );

  // ── Staff without a manager view: big clock + their own entries, as before ──
  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">Time &amp; Attendance</h1>
          {/* timekeepers, foremen and project engineers open the crew's timekeeper sheet from here */}
          {canOpenTimesheets(user) && (
            <Link href="/attendance/timekeeper" className="fx-grad rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white hover:brightness-110">
              Timekeeper sheet →
            </Link>
          )}
        </div>
        <Card className="mx-auto max-w-xl lg:mx-0">
          <CardHeader title="My time clock" subtitle={openEntry ? `Clocked in since ${fmtDateTime(openEntry.timeIn)}` : "Not clocked in"} />
          <CardBody className="space-y-4">
            <AttendanceClock projects={projects} clockedIn={!!openEntry} needsProject={needsProject} />
            {weekendBlock}
          </CardBody>
        </Card>
        <div className="mx-auto max-w-xl lg:mx-0">{myEntries}</div>
      </div>
    );
  }

  // hot = needs a decision (gradient tile), warn = worth a look (amber number); grey "All clear" when nothing is waiting
  const tile = (href: string, count: number, label: string, tone: "hot" | "warn", cta: string) => {
    const active = count > 0;
    const body = (
      <>
        <span className="flex items-start justify-between gap-2">
          <span className={`fx-num font-mono text-3xl font-bold leading-none ${!active ? "text-ink-300" : tone === "warn" ? "text-amber-500" : ""}`}>{count}</span>
          <span className={`fx-cta whitespace-nowrap text-[11px] font-bold uppercase tracking-wide ${!active ? "fx-ok" : tone === "hot" ? "text-white/90" : "text-ink-400"}`}>
            {active ? `${cta} →` : "All clear ✓"}
          </span>
        </span>
        <span className={`fx-sub mt-1.5 block text-xs ${active && tone === "hot" ? "" : "text-ink-600"}`}>{label}</span>
      </>
    );
    const cls = `fx-card block rounded-2xl border px-4 py-3.5 ${active && tone === "hot" ? "fx-tile-hot" : "border-ink-200 bg-ink-50"}`;
    return active ? (
      <Link href={href} className={`${cls} transition hover:-translate-y-0.5`}>
        {body}
      </Link>
    ) : (
      <div className={cls}>{body}</div>
    );
  };

  /** A ring gauge: `pct` 0–100 filled in `color`, with the label in the middle. */
  const ring = (pct: number, color: string, label: React.ReactNode, size = 52) => (
    <span
      className="fx-ring"
      style={{ width: size, height: size, background: `conic-gradient(${color} 0 ${pct}%, rgb(var(--ink-200)) ${pct}% 100%)` }}
    >
      <span className="font-mono text-[11px] font-bold text-ink-900" style={{ width: size - 12, height: size - 12 }}>
        {label}
      </span>
    </span>
  );
  const pctOf = (n: number, d: number) => (d ? Math.min(100, Math.round((n / d) * 100)) : 0);

  const kpiLabel = "text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-400";

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-400">
            {fmtDate(now)}
            <span className="fx-ok inline-flex items-center gap-1.5">
              <span className="fx-live" /> Live
            </span>
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">Time &amp; Attendance</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canOpenTimesheets(user) && (
            <Link href="/attendance/timekeeper" className={btn}>
              Timekeeper sheet
            </Link>
          )}
          {user.role === "OWNER" && (
            <Link href="/attendance/logs" className={btn}>
              Staff time logs
            </Link>
          )}
          <Link href="/attendance/yearly" className={btn}>
            Yearly log
          </Link>
          {canManagePersonnel && <AddPersonnelSection projects={projects} />}
        </div>
      </div>

      {/* 1 — My time clock */}
      <Card className={openEntry ? "fx-clock-on" : ""}>
        <div className="flex flex-col gap-4 px-4 py-4 sm:px-5 lg:flex-row lg:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-4">
            {ring(pctOf(myToday, 8), "rgb(var(--ok))", `${myToday.toFixed(1)}h`, 62)}
            <div className="min-w-0">
              <p className={kpiLabel}>My time clock</p>
              <p className="mt-0.5 flex items-center gap-2 text-base font-bold text-ink-900">
                {openEntry ? <span className="fx-live shrink-0" /> : <span className="h-2 w-2 shrink-0 rounded-full bg-ink-300" />}
                {openEntry
                  ? `On duty since ${manilaDayKey(openEntry.timeIn) === todayKey ? timeFmt.format(openEntry.timeIn) : sinceFmt.format(openEntry.timeIn)}`
                  : "Not clocked in"}
              </p>
              <p className="mt-0.5 text-xs text-ink-500">
                {openEntry && <>{openEntry.project?.name ?? "Office"} · </>}
                <Link href="/attendance?tab=mine" className="font-semibold text-brand-600 hover:underline">
                  My entries →
                </Link>
                {iAmWeekendRestricted && (
                  <>
                    {" · "}
                    <Link href="/attendance?tab=mine#weekend" className="font-semibold text-brand-600 hover:underline">
                      Weekend work request
                    </Link>
                  </>
                )}
              </p>
            </div>
          </div>
          <div className="flex gap-7">
            <div>
              <p className={kpiLabel}>Today</p>
              <p className="font-mono text-2xl font-bold text-ink-900">
                {myToday.toFixed(1)}
                <span className="text-xs font-medium text-ink-400"> h</span>
              </p>
            </div>
            <div>
              <p className={kpiLabel}>Cut-off</p>
              <p className="font-mono text-2xl font-bold text-ink-900">
                {myPeriodHours.toFixed(1)}
                <span className="text-xs font-medium text-ink-400"> h</span>
              </p>
            </div>
          </div>
          <AttendanceClock projects={projects} clockedIn={!!openEntry} needsProject={needsProject} compact />
        </div>
      </Card>

      {/* 2 — Needs your action */}
      <div>
        <div className="mb-2.5 flex items-center gap-3">
          <h2 className="text-sm font-bold text-ink-900">Needs your action</h2>
          <span className="h-px flex-1 bg-ink-200" />
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {canDecideAdjustments && tile("/attendance?tab=requests", pendingAdjustments.length, "Overtime / early-start requests", "hot", "Review")}
          {tile("/attendance?show=none", notLogged, "Not logged today", "hot", "Show")}
          {tile("/attendance?show=stale", kpi.stale, "Still clocked in from earlier days", "warn", "Show")}
          {tile("/attendance#devices", sharedDeviceWarnings.length, "Shared-device warnings", "hot", "See")}
        </div>
      </div>

      {/* 3 — Tabs */}
      <nav className="fx-pills">
        {tabs.map((t) => (
          <Link
            key={t.id}
            href={t.id === "today" ? "/attendance" : `/attendance?tab=${t.id}`}
            className={`fx-pill ${tab === t.id ? "fx-pill-on" : ""}`}
          >
            {t.label}
            {!!t.badge && <span className="ml-1.5 rounded-full bg-amber-400 px-1.5 text-[11px] font-bold text-ink-950 dark:text-[#1d1230]">{t.badge}</span>}
          </Link>
        ))}
      </nav>

      {tab === "today" && (
        <div className="space-y-4">
          {sharedDeviceWarnings.length > 0 && (
            <Card id="devices" className="border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/30">
              <CardHeader
                title={`⚠ ${sharedDeviceWarnings.length} device${sharedDeviceWarnings.length === 1 ? "" : "s"} shared across staff this week`}
                subtitle="The same browser/device tapped Time In for more than one person — not proof of anything (a shared office tablet triggers this too), just worth a look"
              />
              <CardBody className="space-y-1.5 text-sm">
                {sharedDeviceWarnings.map((w) => (
                  <p key={w.deviceId} className="text-red-700 dark:text-red-300">
                    <span className="font-medium">{w.names.join(" & ")}</span> tapped in from the same device this week
                  </p>
                ))}
              </CardBody>
            </Card>
          )}

          {/* 4 — Today at a glance */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card className="flex flex-col items-start gap-2 px-4 py-3.5 sm:flex-row sm:items-center sm:gap-3.5">
              {ring(pctOf(kpi.present, kpi.total), "rgb(var(--ok))", `${pctOf(kpi.present, kpi.total)}%`)}
              <div>
                <p className={kpiLabel}>Present today</p>
                <p className="font-mono text-2xl font-bold text-ink-900">
                  {kpi.present}
                  <span className="text-sm font-medium text-ink-400"> / {kpi.total}</span>
                </p>
              </div>
            </Card>
            <Card className="flex flex-col items-start gap-2 px-4 py-3.5 sm:flex-row sm:items-center sm:gap-3.5">
              {ring(pctOf(kpi.onNow, kpi.total), "rgb(var(--brand-600))", kpi.onNow)}
              <div>
                <p className={kpiLabel}>Clocked in now</p>
                <p className="font-mono text-2xl font-bold text-brand-600">{kpi.onNow}</p>
              </div>
            </Card>
            <Card className="flex flex-col items-start gap-2 px-4 py-3.5 sm:flex-row sm:items-center sm:gap-3.5">
              {ring(pctOf(notLogged, kpi.total), "rgb(var(--accent))", notLogged)}
              <div>
                <p className={kpiLabel}>Not logged</p>
                <p className={`font-mono text-2xl font-bold ${notLogged ? "text-accent" : "text-ink-300"}`}>{notLogged}</p>
                <p className="text-[11px] text-ink-500">{notLogged ? `in ${groupsMissing} group${groupsMissing === 1 ? "" : "s"}` : "everyone is in"}</p>
              </div>
            </Card>
            <Card className="flex flex-col items-start gap-2 px-4 py-3.5 sm:flex-row sm:items-center sm:gap-3.5">
              {ring(pctOf(kpi.manHours, Math.max(1, kpi.total) * 8), "#ff8a3d", "↑")}
              <div>
                <p className={kpiLabel}>Man-hours today</p>
                <p className="font-mono text-2xl font-bold text-ink-900">{kpi.manHours.toFixed(1)}</p>
              </div>
            </Card>
          </div>

          {/* 5 — Crew by project */}
          <AttendanceCrewBoard
            sections={crewSections}
            initialFilter={initialFilter}
            emptyNote="No site rosters yet — assign workers to a project in the Payroll tab."
          />
        </div>
      )}

      {tab === "requests" &&
        canDecideAdjustments &&
        (pendingAdjustments.length > 0 ? (
          <Card className="border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/30">
            <CardHeader
              title={`${pendingAdjustments.length} time-adjustment request${pendingAdjustments.length === 1 ? "" : "s"} awaiting your decision`}
              subtitle="Approving lifts the clamp for that shift/day — for overtime and early starts you can approve only some of the hours; rejecting leaves it as-is. The original clock-in/out record is never changed either way"
            />
            <CardBody className="space-y-3">
              {pendingAdjustments.map((r) => (
                <div key={r.id} className="rounded-lg border border-ink-100 bg-white p-3 text-sm dark:bg-transparent">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-ink-900">
                      {r.employeeName} — {r.type === "EARLY_START" ? "Early start" : r.type === "OVERTIME" ? "Overtime" : "Weekend work"} ·{" "}
                      {r.shiftLabel}
                    </span>
                    <span className="text-xs text-ink-400">requested by {r.requestedByName}</span>
                  </div>
                  <p className="mt-1 text-xs text-ink-600">{r.reason}</p>
                  {(r.gpsIn || r.gpsOut) && (
                    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
                      {r.gpsIn && <LocationPin gps={r.gpsIn} label="Clocked in here" />}
                      {r.gpsOut && <LocationPin gps={r.gpsOut} label="Clocked out here" />}
                    </div>
                  )}
                  <div className="mt-2">
                    <DecideTimeAdjustmentButtons request={r} canExceed={user.role === "OWNER"} />
                  </div>
                </div>
              ))}
            </CardBody>
          </Card>
        ) : (
          <Card>
            <CardBody className="py-8 text-center text-sm text-ink-400">No requests waiting — all clear.</CardBody>
          </Card>
        ))}

      {tab === "approved" && user.role === "OWNER" && (
        <Card>
          <CardHeader
            title="Approved overtime and early starts — last 30 days"
            subtitle="Change how many hours were credited. Payroll runs that were already generated are not rewritten; the next run uses the new number."
          />
          <CardBody className="space-y-3">
            {approvedHours.map((r) => (
              <div key={r.id} className="rounded-lg border border-ink-100 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-ink-900">
                    {r.employeeName} — {r.type === "OVERTIME" ? "Overtime" : "Early start"} · {r.shiftLabel}
                  </span>
                  <span className={`text-xs font-semibold tabular-nums ${r.creditedHours !== r.claimedHours ? "text-amber-700" : "text-emerald-700"}`}>
                    {r.creditedHours} h credited
                    {r.creditedHours < r.claimedHours ? ` of ${r.claimedHours} h clocked` : r.creditedHours > r.claimedHours ? ` (${r.claimedHours} h clocked)` : ""}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-ink-500">{r.clockLabel}</p>
                <div className="mt-1">
                  <EditApprovedHours row={r} />
                </div>
              </div>
            ))}
            {approvedHours.length === 0 && <p className="py-4 text-center text-sm text-ink-400">Nothing approved in the last 30 days.</p>}
          </CardBody>
        </Card>
      )}

      {tab === "mine" && (
        <div className="space-y-4">
          {myEntries}
          {weekendBlock && (
            <div id="weekend" className="max-w-xl">
              {weekendBlock}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
