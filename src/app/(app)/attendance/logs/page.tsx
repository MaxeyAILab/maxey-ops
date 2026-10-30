import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fmtDateTime } from "@/lib/format";
import { Card, CardBody, CardHeader, Table, Td, Th } from "@/components/ui";
import { LocationPin } from "@/components/location-pin";
import { computeDailyHoursByDay, fetchApprovals, fetchDailyOverrides } from "@/lib/payroll";
import { manilaSemiMonthlyPeriod, manilaWeeklySitePeriod, rulesetForDepartment } from "@/lib/time-rules";

export const metadata = { title: "Staff Time Logs" };
export const dynamic = "force-dynamic";

const MAX_BACK = 12;

const dayLabel = (dayKey: string) =>
  new Date(`${dayKey}T12:00:00.000Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

/**
 * Staff time logs (Owner only) — every clock-in/out of any staff member for one pay cut-off, with the hours payroll counts for
 * each day. Office staff and architects/engineers are on the 1st–15th / 16th–end cut-off, site workers and drivers on the
 * Friday-to-Friday week; "back" steps to earlier cut-offs.
 */
export default async function StaffTimeLogsPage({ searchParams }: { searchParams: { u?: string; back?: string } }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "OWNER") redirect("/attendance");

  const people = await prisma.user.findMany({
    where: { active: true, role: { not: "CLIENT" } },
    orderBy: [{ department: "asc" }, { name: "asc" }],
    select: { id: true, name: true, department: true, position: true },
  });
  const person = people.find((p) => p.id === searchParams.u) ?? null;
  const back = Math.min(Math.max(Math.floor(Number(searchParams.back)) || 0, 0), MAX_BACK);

  const weekly = person?.department === "SITE" || person?.department === "DRIVER";
  const period = person ? (weekly ? manilaWeeklySitePeriod(new Date(), back) : manilaSemiMonthlyPeriod(new Date(), back)) : null;

  const records =
    person && period
      ? await prisma.attendance.findMany({
          where: { userId: person.id, timeIn: { gte: period.start, lte: period.end } },
          orderBy: { timeIn: "desc" },
          include: { project: { select: { name: true } } },
        })
      : [];

  let counted: [string, number][] = [];
  if (person && period) {
    const closed = records.filter((r) => r.timeOut);
    const [approvals, overrides] = await Promise.all([fetchApprovals(closed), fetchDailyOverrides([person.id], period.start, period.end)]);
    counted = [...computeDailyHoursByDay(person.id, closed, rulesetForDepartment(person.department), approvals, overrides).entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }
  const countedTotal = counted.reduce((s, [, h]) => s + h, 0);
  const href = (n: number) => `/attendance/logs?u=${person?.id ?? ""}&back=${n}`;
  const hoursBetween = (a: Date, b: Date | null) => (b ? Math.round(((b.getTime() - a.getTime()) / 3_600_000) * 100) / 100 : null);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/attendance" className="text-xs text-ink-400 hover:text-ink-600">
          ← Attendance
        </Link>
        <h1 className="text-xl font-bold text-ink-900">Staff time logs</h1>
        <p className="text-sm text-ink-500">Every clock-in and clock-out of one person for a whole pay cut-off, with the hours payroll counts for each day.</p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="u" className="mb-1 block text-xs font-medium text-ink-600">
            Staff member
          </label>
          <select id="u" name="u" defaultValue={person?.id ?? ""} className="rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm dark:bg-transparent" required>
            <option value="" disabled>
              Choose a person…
            </option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {p.position ?? p.department ?? ""}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
          Show log
        </button>
      </form>

      {person && period && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-ink-900">
                {person.name} — {period.label}
              </h2>
              <p className="text-xs text-ink-500">{weekly ? "Weekly cut-off (Friday 5pm to Friday 5pm)" : "Semi-monthly cut-off (1st–15th and 16th–end of month)"}</p>
            </div>
            <div className="flex items-center gap-3 text-xs font-medium">
              {back < MAX_BACK && (
                <Link href={href(back + 1)} className="text-brand-600 hover:underline">
                  ← Earlier cut-off
                </Link>
              )}
              {back > 0 && (
                <>
                  <Link href={href(back - 1)} className="text-brand-600 hover:underline">
                    Later cut-off →
                  </Link>
                  <Link href={href(0)} className="text-brand-600 hover:underline">
                    Current
                  </Link>
                </>
              )}
            </div>
          </div>

          <Card>
            <CardHeader title={`Clock-ins and clock-outs (${records.length})`} subtitle="Newest first — the original record, exactly as it was tapped" />
            <Table>
              <thead>
                <tr>
                  <Th>Time in</Th>
                  <Th>Time out</Th>
                  <Th>Clocked</Th>
                  <Th>Site</Th>
                  <Th>Device</Th>
                  <Th>Location</Th>
                </tr>
              </thead>
              <tbody>
                {records.map((a) => {
                  const h = hoursBetween(a.timeIn, a.timeOut);
                  return (
                    <tr key={a.id}>
                      <Td className="text-xs">{fmtDateTime(a.timeIn)}</Td>
                      <Td className="text-xs">{a.timeOut ? fmtDateTime(a.timeOut) : "— open —"}</Td>
                      <Td className="text-xs tabular-nums">{h === null ? "—" : `${h} h`}</Td>
                      <Td className="text-xs">{a.project?.name ?? "Office"}</Td>
                      <Td className="text-xs text-ink-500">{a.deviceIn ?? "—"}</Td>
                      <Td className="text-xs">
                        <div className="flex flex-col items-start gap-1">
                          <LocationPin gps={a.gpsIn} label="In" />
                          {a.timeOut && a.gpsOut && <LocationPin gps={a.gpsOut} label="Out" />}
                        </div>
                      </Td>
                    </tr>
                  );
                })}
                {records.length === 0 && (
                  <tr>
                    <Td colSpan={6} className="py-6 text-center text-ink-400">
                      No clock-ins in this cut-off.
                    </Td>
                  </tr>
                )}
              </tbody>
            </Table>
          </Card>

          {counted.length > 0 && (
            <Card>
              <CardHeader title={`Hours payroll counts — ${Math.round(countedTotal * 100) / 100} h`} subtitle="Per day, after the schedule rules, breaks, approved overtime/early starts and any hours you edited" />
              <CardBody>
                <ul className="grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
                  {counted.map(([day, h]) => (
                    <li key={day} className="flex items-center justify-between border-b border-ink-100 py-1">
                      <span className="text-ink-700">{dayLabel(day)}</span>
                      <span className="font-medium tabular-nums text-ink-900">{Math.round(h * 100) / 100} h</span>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
