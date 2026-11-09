import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardBody, CardHeader } from "@/components/ui";
import { AddSheetWorker, TimekeeperSheet, type SheetWorker } from "@/components/timekeeper-sheet";
import { CHARGEABLE_STATUSES } from "@/lib/project-status";
import { manilaDayKey, manilaTime, manilaWeeklySitePeriod } from "@/lib/time-rules";
import { approvalOverdue, canApproveSheet, canEditSheet, canOpenTimesheets, canReviewSheet, isSundayKey, lineStage, overdueText, regularHours, sheetProgress, worksSheetFreely } from "@/lib/timesheet";
import { dayClosedByPayroll } from "@/lib/timesheet-db";

export const metadata = { title: "Timekeeper sheet" };
export const dynamic = "force-dynamic";

const addDays = (dayKey: string, n: number) => new Date(new Date(`${dayKey}T12:00:00.000Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const dayLabel = (dayKey: string) => new Date(`${dayKey}T12:00:00.000Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const longDay = (dayKey: string) => new Date(`${dayKey}T12:00:00.000Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const FOREMAN_OR_ENGINEER = /foreman|engineer|engr/i;

/**
 * Timekeeper sheet (Attendance tab) — the daily time record for workers who have no login of their own. The timekeeper, the PM and
 * the Owner fill it in for a project and a day; the times become the workers' clock records, so payroll and the Attendance summary
 * count them like anyone else's.
 */
export default async function TimekeeperPage({ searchParams }: { searchParams: { project?: string; date?: string } }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role === "CLIENT") redirect("/portal");
  if (!canOpenTimesheets(user)) redirect("/attendance");

  const todayKey = manilaDayKey(new Date());
  const requested = searchParams.date && /^\d{4}-\d{2}-\d{2}$/.test(searchParams.date) ? searchParams.date : todayKey;
  const dayKey = requested > todayKey ? todayKey : requested;
  const sees = worksSheetFreely(user);

  const projects = await prisma.project.findMany({
    where: sees
      ? { status: { in: CHARGEABLE_STATUSES }, assignments: { some: { active: true } } }
      : { status: { in: CHARGEABLE_STATUSES }, assignments: { some: { userId: user.id, active: true } } },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  const project = projects.find((p) => p.id === searchParams.project) ?? projects[0] ?? null;

  const header = (
    <div>
      <Link href="/attendance" className="text-xs text-ink-400 hover:text-ink-600">
        ← Attendance
      </Link>
      <h1 className="text-xl font-bold text-ink-900">Timekeeper sheet</h1>
      <p className="text-sm text-ink-500">
        The daily time record of everyone assigned to the project. The timekeeper fills it in; then the foreman ticks <b>Checked and reviewed</b> and the project engineer ticks <b>Approved</b>. A worker who clocked in on their own that day shows their own times.
      </p>
    </div>
  );

  if (!project) {
    return (
      <div className="space-y-6">
        {header}
        <Card>
          <CardBody className="text-sm text-ink-500">
            {sees ? "No project has anyone assigned yet." : "You are not assigned to a project yet — ask the Owner to assign you to one (Attendance → Edit)."}
          </CardBody>
        </Card>
      </div>
    );
  }

  const [roster, entries, mine] = await Promise.all([
    prisma.projectAssignment.findMany({
      where: { projectId: project.id, active: true },
      orderBy: { user: { name: "asc" } },
      select: { user: { select: { id: true, name: true, position: true, role: true, email: true, department: true, active: true } } },
    }),
    prisma.timesheetEntry.findMany({ where: { projectId: project.id, date: { gte: new Date(`${addDays(dayKey, -13)}T00:00:00.000Z`), lte: new Date(`${dayKey}T00:00:00.000Z`) } } }),
    prisma.projectAssignment.findFirst({ where: { projectId: project.id, userId: user.id, active: true }, select: { id: true } }),
  ]);
  const people = roster.map((r) => r.user).filter((u) => u.active);
  // everyone assigned to the project is on the sheet; a worker who clocked in on their own that day shows what they clocked instead
  const workersOnSheet = people;
  const dayStart = manilaTime(dayKey, 0, 0);
  const selfRecords = await prisma.attendance.findMany({
    where: { projectId: project.id, userId: { in: people.map((u) => u.id) }, source: { not: "timekeeper" }, timeIn: { gte: dayStart, lt: new Date(dayStart.getTime() + 86_400_000) } },
    orderBy: { timeIn: "asc" },
    select: { userId: true, timeIn: true, timeOut: true },
  });
  const clock = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  const selfText = new Map<string, string>();
  for (const r of selfRecords) selfText.set(r.userId, [selfText.get(r.userId), `${clock(r.timeIn)}–${r.timeOut ? clock(r.timeOut) : "still in"}`].filter(Boolean).join(", "));
  const approvers = Array.from(new Set(people.filter((u) => u.role === "FOREMAN" || u.department === "ENGINEER" || FOREMAN_OR_ENGINEER.test(u.position ?? "")).map((u) => u.name)));

  const dayEntries = new Map(entries.filter((e) => e.date.toISOString().slice(0, 10) === dayKey).map((e) => [e.userId, e]));
  const pmIds = [...dayEntries.values()].map((e) => e.pmAttendanceId).filter((x): x is string => !!x);
  const otRequests = pmIds.length ? await prisma.timeAdjustmentRequest.findMany({ where: { attendanceId: { in: pmIds }, type: "OVERTIME" }, select: { attendanceId: true, status: true, approvedHours: true } }) : [];
  const otByAttendance = new Map(otRequests.map((r) => [r.attendanceId, r]));

  const workers: SheetWorker[] = workersOnSheet.map((u) => {
    const e = dayEntries.get(u.id);
    const ot = e?.pmAttendanceId ? otByAttendance.get(e.pmAttendanceId) : undefined;
    return {
      userId: u.id,
      name: u.name,
      position: u.position ?? "—",
      department: u.department,
      selfClock: selfText.get(u.id) ?? null,
      saved: e
        ? {
            amIn: e.amIn,
            amOut: e.amOut,
            pmIn: e.pmIn,
            pmOut: e.pmOut,
            otHours: e.otHours ? Number(e.otHours) : null,
            approvedBy: e.approvedBy,
            remarks: e.remarks,
            absent: e.absent,
            enteredByName: e.enteredByName,
            otStatus: ot ? (ot.status as "PENDING" | "APPROVED" | "REJECTED") : null,
            otCredited: ot?.approvedHours != null ? Number(ot.approvedHours) : null,
            stage: lineStage(e),
            reviewedByName: e.reviewedByName,
            reviewedAt: e.reviewedAt ? e.reviewedAt.toISOString() : null,
            approvedByName: e.engineerApprovedByName,
            approvedAt: e.engineerApprovedAt ? e.engineerApprovedAt.toISOString() : null,
            weekendStatus: (e.weekendStatus as "PENDING" | "APPROVED" | "REJECTED" | null) ?? null,
            weekendDecidedByName: e.weekendDecidedByName,
          }
        : null,
    };
  });

  const allowed = canEditSheet(user, { assignedToProject: !!mine, dayKey, todayKey });
  const reviewCtx = { assignedToProject: !!mine };
  // a day that has passed without the project engineer approving everything recorded for it
  const progress = sheetProgress([...dayEntries.values()].map((e) => ({ userId: e.userId, stage: lineStage(e) })));
  const overdue = approvalOverdue(dayKey, todayKey, progress) ? `This day has passed and it is not fully approved: ${overdueText(progress)}.` : null;
  const closed = await dayClosedByPayroll(prisma, project.id, dayKey);
  const lockedReason = closed ? "Payroll for this project has already been approved for this day, so its sheet is closed." : allowed.ok ? null : allowed.reason;

  // the pay week this day belongs to (Saturday to Friday): each worker's paid hours per day, for a quick look
  const weekEnd = manilaWeeklySitePeriod(new Date(`${dayKey}T12:00:00.000Z`)).end;
  const weekEndKey = manilaDayKey(weekEnd);
  const weekDays = Array.from({ length: 7 }, (_, k) => addDays(weekEndKey, k - 6));
  const weekEntries = await prisma.timesheetEntry.findMany({
    where: { projectId: project.id, date: { gte: new Date(`${weekDays[0]}T00:00:00.000Z`), lte: new Date(`${weekDays[6]}T00:00:00.000Z`) } },
  });
  const cellOf = (userId: string, day: string) => {
    const e = weekEntries.find((x) => x.userId === userId && x.date.toISOString().slice(0, 10) === day);
    if (!e) return null;
    if (e.absent) return { text: "A", ot: 0 };
    if (e.weekendStatus === "PENDING") return { text: "⏳", ot: 0 }; // Sunday work waiting for the Owner: not paid yet
    if (e.weekendStatus === "REJECTED") return { text: "✕", ot: 0 };
    const hours = regularHours(day, { amIn: e.amIn, amOut: e.amOut, pmIn: e.pmIn, pmOut: e.pmOut, otHours: e.otHours ? Number(e.otHours) : null, approvedBy: e.approvedBy, remarks: e.remarks, absent: false }, workersOnSheet.find((w) => w.id === userId)?.department ?? "SITE");
    return { text: hours.toFixed(1).replace(/\.0$/, ""), ot: e.otHours ? Number(e.otHours) : 0 };
  };
  const prevDay = addDays(dayKey, -1);
  const nextDay = addDays(dayKey, 1);
  const q = (project_: string, date: string) => `/attendance/timekeeper?project=${project_}&date=${date}`;

  return (
    <div className="space-y-6">
      {header}

      <form method="get" className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="project" className="mb-1 block text-xs font-medium text-ink-600">
            Project
          </label>
          <select id="project" name="project" defaultValue={project.id} className="rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm dark:bg-transparent">
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="date" className="mb-1 block text-xs font-medium text-ink-600">
            Day
          </label>
          <input id="date" name="date" type="date" max={todayKey} defaultValue={dayKey} className="rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm dark:bg-transparent" />
        </div>
        <button type="submit" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
          Show
        </button>
        <span className="flex items-center gap-3 pb-2 text-xs font-medium">
          <Link href={q(project.id, prevDay)} className="text-brand-600 hover:underline">
            ← {dayLabel(prevDay)}
          </Link>
          {dayKey < todayKey && (
            <>
              <Link href={q(project.id, nextDay)} className="text-brand-600 hover:underline">
                {dayLabel(nextDay)} →
              </Link>
              <Link href={q(project.id, todayKey)} className="text-brand-600 hover:underline">
                Today
              </Link>
            </>
          )}
        </span>
      </form>

      <Card>
        <CardHeader title={`${project.name} — ${longDay(dayKey)}`} subtitle={`${workersOnSheet.length} worker${workersOnSheet.length === 1 ? "" : "s"} assigned to this project${selfText.size > 0 ? ` · ${selfText.size} clocked in on their own today` : ""}`} />
        <CardBody className="space-y-3">
          {allowed.ok && !lockedReason && <AddSheetWorker projectId={project.id} dayKey={dayKey} todayKey={todayKey} />}
          <TimekeeperSheet key={`${project.id}|${dayKey}|${workers.length}`} projectId={project.id} dayKey={dayKey} workers={workers} approvers={approvers} canEdit={allowed.ok} lockedReason={lockedReason} canReview={canReviewSheet(user, reviewCtx) && !closed} canApprove={canApproveSheet(user, reviewCtx) && !closed} isSunday={isSundayKey(dayKey)} canDecideWeekend={user.role === "OWNER" && !closed} overdueNote={overdue} />
        </CardBody>
      </Card>

      {workersOnSheet.length > 0 && (
        <Card>
          <CardHeader title="This pay week" subtitle={`${dayLabel(weekDays[0])} – ${dayLabel(weekDays[6])} · paid hours per day (A = absent, ⏳ = Sunday work waiting for the Owner, +n = overtime recorded, counted once approved)`} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-3 py-2 text-left">Worker</th>
                  {weekDays.map((d) => (
                    <th key={d} className={`px-2 py-2 text-center ${d === dayKey ? "text-brand-700" : ""}`}>
                      {dayLabel(d).split(",")[0]}
                      <div className="font-normal normal-case">{d.slice(8)}</div>
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {workersOnSheet.map((w) => {
                  const cells = weekDays.map((d) => cellOf(w.id, d));
                  const total = cells.reduce((s, c) => s + (c && Number.isFinite(Number(c.text)) ? Number(c.text) : 0), 0);
                  return (
                    <tr key={w.id}>
                      <td className="px-3 py-1.5 font-medium text-ink-800">{w.name}</td>
                      {cells.map((c, k) => (
                        <td key={weekDays[k]} className="px-2 py-1.5 text-center tabular-nums text-ink-700">
                          {c ? (
                            <>
                              {c.text}
                              {c.ot > 0 && <span className="ml-0.5 text-[11px] text-amber-700">+{c.ot}</span>}
                            </>
                          ) : (
                            <span className="text-ink-300">·</span>
                          )}
                        </td>
                      ))}
                      <td className="px-3 py-1.5 text-right font-medium tabular-nums text-ink-900">{total.toFixed(1).replace(/\.0$/, "")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
