import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardBody, CardHeader, Table, Td, Th } from "@/components/ui";
import { computeDailyHoursByDay, fetchApprovals, fetchDailyOverrides } from "@/lib/payroll";
import { manilaTime, rulesetForDepartment } from "@/lib/time-rules";

export const metadata = { title: "Yearly Hours" };
export const dynamic = "force-dynamic";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Yearly hours log (Spec: "log all their total hours separately for the
 * whole year on a separate window") — every active employee's cumulative
 * hours for a calendar year, by month, using the exact same day-bucketed,
 * capped-unless-approved computation the attendance summary and payroll use
 * (computeDailyHoursByDay), so this number is never a third, different one.
 */
export default async function YearlyHoursPage({
  searchParams,
}: {
  searchParams: { year?: string };
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!["OWNER", "ACCOUNTING", "PM"].includes(user.role)) redirect("/attendance");

  const now = new Date();
  const currentYear = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric" }).format(now));
  const year = Number(searchParams.year) || currentYear;

  const yearStart = manilaTime(`${year}-01-01`, 0, 0);
  const yearEnd = manilaTime(`${year}-12-31`, 23, 59);

  const [users, attendance] = await Promise.all([
    prisma.user.findMany({
      where: { active: true, role: { not: "CLIENT" } },
      orderBy: [{ department: "asc" }, { name: "asc" }],
      select: { id: true, name: true, department: true, position: true },
    }),
    prisma.attendance.findMany({
      where: { timeIn: { gte: yearStart, lte: yearEnd }, timeOut: { not: null } },
    }),
  ]);

  const userIds = users.map((u) => u.id);
  const [approvals, overrides] = await Promise.all([
    fetchApprovals(attendance),
    fetchDailyOverrides(userIds, yearStart, yearEnd),
  ]);

  const rows = users
    .map((u) => {
      const records = attendance.filter((a) => a.userId === u.id);
      if (records.length === 0) return null;
      const ruleset = rulesetForDepartment(u.department);
      const byDay = computeDailyHoursByDay(u.id, records, ruleset, approvals, overrides);
      const byMonth = new Array(12).fill(0);
      let total = 0;
      for (const [dayKey, hours] of byDay) {
        const monthIndex = Number(dayKey.slice(5, 7)) - 1;
        byMonth[monthIndex] += hours;
        total += hours;
      }
      return { user: u, byMonth, total };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  const yearOptions = Array.from({ length: 3 }, (_, i) => currentYear - i);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/attendance" className="text-xs text-ink-400 hover:text-ink-600">
            ← Attendance
          </Link>
          <h1 className="text-xl font-bold text-ink-900">Yearly Hours Log</h1>
          <p className="text-xs text-ink-500">
            Every employee&apos;s cumulative hours for {year}, by month — the same capped,
            approval-aware figures used for payroll.
          </p>
        </div>
        <div className="flex gap-1 text-sm">
          {yearOptions.map((y) => (
            <Link
              key={y}
              href={`/attendance/yearly?year=${y}`}
              className={
                y === year
                  ? "rounded-lg bg-brand-500 px-3 py-1.5 font-medium text-white"
                  : "rounded-lg border border-ink-200 px-3 py-1.5 text-ink-600 hover:bg-ink-50"
              }
            >
              {y}
            </Link>
          ))}
        </div>
      </div>

      <Card>
        <CardHeader title={`${rows.length} employee(s) with logged hours in ${year}`} />
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Dept</Th>
              {MONTH_LABELS.map((m) => (
                <Th key={m} className="text-right">
                  {m}
                </Th>
              ))}
              <Th className="text-right">Total</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.user.id}>
                <Td className="font-medium">{r.user.name}</Td>
                <Td className="text-xs text-ink-500">{r.user.department ?? "—"}</Td>
                {r.byMonth.map((h, i) => (
                  <Td key={i} className="text-right tabular-nums text-ink-600">
                    {h > 0 ? h.toFixed(1) : "—"}
                  </Td>
                ))}
                <Td className="text-right font-semibold tabular-nums text-brand-600">
                  {r.total.toFixed(1)}
                </Td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <Td colSpan={15} className="py-6 text-center text-ink-400">
                  No logged hours for {year}.
                </Td>
              </tr>
            )}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
