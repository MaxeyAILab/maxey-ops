import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fmtDate, php } from "@/lib/format";
import {
  COMPLETED_STATUSES,
  ONGOING_STATUSES,
  PROSPECTIVE_STATUSES,
} from "@/lib/project-status";
import { Badge, Card, CardHeader, Table, Td, Th } from "@/components/ui";
import { AddProjectSection, ProjectStatusSelect } from "@/components/project-management";
import { FINANCE_ROLES } from "@/lib/rbac";
import { canAccess } from "@/lib/access";

export const metadata = { title: "Projects" };
export const dynamic = "force-dynamic";

type ProjectRow = Awaited<ReturnType<typeof getProjects>>[number];

function getProjects() {
  return prisma.project.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      client: { select: { name: true } },
      progressEntries: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
}

export default async function ProjectsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role === "CLIENT") redirect("/portal");
  if (!canAccess(user.role, user.department, "/projects")) redirect("/attendance");

  const projects = await getProjects();
  const showMoney = FINANCE_ROLES.includes(user.role) || user.role === "PM";
  const canManage = ["OWNER", "PM"].includes(user.role);

  const ongoing = projects.filter((p) => (ONGOING_STATUSES as string[]).includes(p.status));
  const prospective = projects.filter((p) =>
    (PROSPECTIVE_STATUSES as string[]).includes(p.status)
  );
  const completed = projects.filter((p) => (COMPLETED_STATUSES as string[]).includes(p.status));

  const renderTable = (rows: ProjectRow[], emptyText: string) => (
    <Table>
      <thead>
        <tr>
          <Th>Project</Th>
          <Th>Owner</Th>
          <Th>Status</Th>
          {showMoney && <Th className="text-right">Contract</Th>}
          <Th className="text-right">Progress</Th>
          <Th>Started</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => (
          <tr key={p.id} className="hover:bg-ink-50">
            <Td>
              <Link
                href={`/projects/${p.id}`}
                className="font-medium text-brand-600 hover:underline"
              >
                {p.name}
              </Link>
              <div className="text-xs text-ink-400">{p.address}</div>
            </Td>
            <Td>{p.client.name}</Td>
            <Td>
              {canManage ? (
                <ProjectStatusSelect projectId={p.id} current={p.status} />
              ) : (
                <Badge value={p.status} />
              )}
            </Td>
            {showMoney && (
              <Td className="text-right tabular-nums">{php(p.contractValue.toString())}</Td>
            )}
            <Td className="text-right tabular-nums">
              {Number(p.progressEntries[0]?.pctComplete ?? 0).toFixed(0)}%
            </Td>
            <Td>{fmtDate(p.startDate)}</Td>
          </tr>
        ))}
        {rows.length === 0 && (
          <tr>
            <Td colSpan={showMoney ? 6 : 5} className="py-8 text-center text-ink-400">
              {emptyText}
            </Td>
          </tr>
        )}
      </tbody>
    </Table>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-xl font-bold text-ink-900">Projects</h1>
        {canManage && <AddProjectSection />}
      </div>

      <Card>
        <CardHeader
          title={`a. On-going Projects (${ongoing.length})`}
          subtitle="Mobilization · On-going Construction · Project On-hold · For Punchlist"
        />
        {renderTable(ongoing, "No on-going projects.")}
      </Card>

      <Card>
        <CardHeader
          title={`b. Prospective Projects (${prospective.length})`}
          subtitle="For Site Survey · Not Active — plus new leads converted from the CRM"
        />
        {renderTable(prospective, "No prospective projects — convert a won lead or add one manually.")}
      </Card>

      <Card>
        <CardHeader
          title={`c. Completed / Turn-over Projects (${completed.length})`}
          subtitle="Projects marked Turned-over move here automatically"
        />
        {renderTable(completed, "No turned-over projects yet.")}
      </Card>
    </div>
  );
}
