import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fmtDate } from "@/lib/format";
import { Badge, Card, CardHeader, Table, Td, Th } from "@/components/ui";
import { AccountToggleButton, ResetPasswordButton } from "@/components/portal-access";

export const metadata = { title: "People" };
export const dynamic = "force-dynamic";

/**
 * People directory (Owner + Accounting): every account — staff and client
 * portals, active and deactivated — with password reset and
 * deactivate/reactivate. Accounts are never deleted (audit trail, Spec §8).
 */
export default async function PeoplePage() {
  const user = await getSessionUser();
  if (!user || user.role !== "OWNER") redirect("/attendance"); // Owner-only

  const users = await prisma.user.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    include: {
      client: { select: { name: true } },
      assignments: {
        where: { active: true },
        include: { project: { select: { name: true } } },
      },
    },
  });

  const staff = users.filter((u) => u.role !== "CLIENT");
  const clients = users.filter((u) => u.role === "CLIENT");

  const renderRow = (u: (typeof users)[number]) => (
    <tr key={u.id} className={u.active ? "" : "opacity-60"}>
      <Td className="font-medium">
        {u.name}
        {u.mustChangePassword && u.active && (
          <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">
            temp password
          </span>
        )}
      </Td>
      <Td className="text-ink-600">
        {u.role === "CLIENT" ? (u.client?.name ?? "—") : (u.position ?? u.role)}
      </Td>
      <Td className="text-xs text-ink-500">
        {u.email.endsWith("@staff.maxeyconstruction.ph") ? (
          <span className="text-ink-300">no login (placeholder)</span>
        ) : (
          u.email
        )}
      </Td>
      <Td className="text-xs text-ink-500">
        {u.role === "CLIENT"
          ? "Client portal"
          : u.assignments.map((a) => a.project.name).join(", ") || (u.department ?? "—")}
      </Td>
      <Td>
        <Badge value={u.active ? "ACTIVE" : "NOT_ACTIVE"} label={u.active ? "Active" : "Deactivated"} />
      </Td>
      <Td className="text-xs text-ink-400">{fmtDate(u.createdAt)}</Td>
      <Td className="text-right">
        {u.role !== "OWNER" && u.id !== user.id && (
          <div className="flex items-center justify-end gap-1">
            {u.active && !u.email.endsWith("@staff.maxeyconstruction.ph") && (
              <ResetPasswordButton userId={u.id} name={u.name} />
            )}
            <AccountToggleButton userId={u.id} name={u.name} active={u.active} />
          </div>
        )}
      </Td>
    </tr>
  );

  const header = (
    <tr>
      <Th>Name</Th>
      <Th>Position / Client</Th>
      <Th>Login email</Th>
      <Th>Assignment</Th>
      <Th>Status</Th>
      <Th>Since</Th>
      <Th />
    </tr>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-ink-900">People</h1>
        <p className="text-sm text-ink-500">
          Staff accounts are created from Attendance → Add personnel; client portal logins from
          each project&apos;s Portal Access panel. Nothing is ever deleted — deactivate instead,
          and reactivate anytime.
        </p>
      </div>

      <Card>
        <CardHeader title={`Staff (${staff.length})`} />
        <Table>
          <thead>{header}</thead>
          <tbody>{staff.map(renderRow)}</tbody>
        </Table>
      </Card>

      <Card>
        <CardHeader title={`Client portal accounts (${clients.length})`} />
        <Table>
          <thead>{header}</thead>
          <tbody>
            {clients.map(renderRow)}
            {clients.length === 0 && (
              <tr>
                <Td colSpan={7} className="py-6 text-center text-ink-400">
                  No client accounts yet — create one from a project&apos;s Portal Access panel.
                </Td>
              </tr>
            )}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
