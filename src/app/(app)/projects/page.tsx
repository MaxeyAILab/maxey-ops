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
import { Badge, Table, Td, Th } from "@/components/ui";
import {
  AddProjectSection,
  DeleteProjectButton,
  ProjectStatusSelect,
} from "@/components/project-management";
import { FINANCE_ROLES } from "@/lib/rbac";
import { canAccess } from "@/lib/access";
import { computeWorkItemStatuses, weightedAccomplishment } from "@/lib/progress";

export const metadata = { title: "Projects" };
export const dynamic = "force-dynamic";

type ProjectRow = Awaited<ReturnType<typeof getProjects>>[number];

// Each section is three-toned: strong title bar, medium column-heading row, very light body.
const TONES = {
  green: {
    frame: "border-emerald-300 dark:border-emerald-800",
    title: "bg-emerald-700 text-white dark:bg-emerald-800",
    subtitle: "text-emerald-100",
    head: "[&_th]:!bg-emerald-200 [&_th]:!text-emerald-900 [&_th]:!border-emerald-300 dark:[&_th]:!bg-emerald-900/70 dark:[&_th]:!text-emerald-100 dark:[&_th]:!border-emerald-800",
    body: "bg-emerald-50 dark:bg-emerald-950/40",
    row: "hover:bg-emerald-100/70 dark:hover:bg-emerald-900/30",
  },
  yellow: {
    frame: "border-amber-300 dark:border-amber-800",
    title: "bg-amber-500 text-amber-950 dark:bg-amber-700 dark:text-amber-50",
    subtitle: "text-amber-900/80 dark:text-amber-100/80",
    head: "[&_th]:!bg-amber-200 [&_th]:!text-amber-950 [&_th]:!border-amber-300 dark:[&_th]:!bg-amber-900/60 dark:[&_th]:!text-amber-100 dark:[&_th]:!border-amber-800",
    body: "bg-amber-50 dark:bg-amber-950/40",
    row: "hover:bg-amber-100/70 dark:hover:bg-amber-900/30",
  },
  grey: {
    frame: "border-slate-300 dark:border-slate-700",
    title: "bg-slate-600 text-white dark:bg-slate-700",
    subtitle: "text-slate-200",
    head: "[&_th]:!bg-slate-200 [&_th]:!text-slate-800 [&_th]:!border-slate-300 dark:[&_th]:!bg-slate-800 dark:[&_th]:!text-slate-200 dark:[&_th]:!border-slate-700",
    body: "bg-slate-50 dark:bg-slate-900/50",
    row: "hover:bg-slate-100 dark:hover:bg-slate-800/40",
  },
} as const;

type Tone = keyof typeof TONES;

function getProjects() {
  return prisma.project.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      client: { select: { name: true } },
      // No `take` — the weighted-accomplishment rollup needs each work
      // item's latest entry, not just the single most-recent one overall.
      progressEntries: { orderBy: { createdAt: "desc" } },
    },
  });
}

export default async function ProjectsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role === "CLIENT") redirect("/portal");
  if (!canAccess(user.role, user.department, "/projects", user.customMenus, user.useCustomMenus)) {
    redirect("/attendance");
  }

  const projects = await getProjects();
  const showMoney = FINANCE_ROLES.includes(user.role) || user.role === "PM";
  const canManage = ["OWNER", "PM"].includes(user.role);
  const isOwner = user.role === "OWNER";

  const ongoing = projects.filter((p) => (ONGOING_STATUSES as string[]).includes(p.status));
  const prospective = projects.filter((p) =>
    (PROSPECTIVE_STATUSES as string[]).includes(p.status)
  );
  const completed = projects.filter((p) => (COMPLETED_STATUSES as string[]).includes(p.status));

  const renderTable = (rows: ProjectRow[], emptyText: string, tone: Tone) => (
    <Table>
      <thead>
        <tr className={TONES[tone].head}>
          <Th>Project</Th>
          <Th>Owner</Th>
          <Th>Status</Th>
          {showMoney && <Th className="text-right">Contract</Th>}
          <Th className="text-right">Progress</Th>
          <Th>Started</Th>
          {isOwner && <Th />}
        </tr>
      </thead>
      <tbody className={TONES[tone].body}>
        {rows.map((p) => (
          <tr key={p.id} className={TONES[tone].row}>
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
              {weightedAccomplishment(computeWorkItemStatuses(p.progressEntries)).toFixed(0)}%
            </Td>
            <Td>{fmtDate(p.startDate)}</Td>
            {isOwner && (
              <Td className="text-right">
                <DeleteProjectButton projectId={p.id} name={p.name} />
              </Td>
            )}
          </tr>
        ))}
        {rows.length === 0 && (
          <tr>
            <Td colSpan={showMoney ? (isOwner ? 7 : 6) : isOwner ? 6 : 5} className="py-8 text-center text-ink-400">
              {emptyText}
            </Td>
          </tr>
        )}
      </tbody>
    </Table>
  );

  const section = (tone: Tone, title: string, rows: ProjectRow[], subtitle: string, emptyText: string) => (
    <div className={`overflow-hidden rounded-sm border ${TONES[tone].frame}`}>
      <div className={`px-4 py-3 sm:px-5 ${TONES[tone].title}`}>
        <h3 className="text-sm font-semibold">
          {title} ({rows.length})
        </h3>
        <p className={`mt-0.5 text-xs ${TONES[tone].subtitle}`}>{subtitle}</p>
      </div>
      {renderTable(rows, emptyText, tone)}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-xl font-bold text-ink-900">Projects</h1>
        {canManage && <AddProjectSection />}
      </div>

      {section("green", "On-going Projects", ongoing, "Mobilization · On-going Construction · Project On-hold · For Punchlist", "No on-going projects.")}
      {section("yellow", "Prospective Projects", prospective, "For Site Survey · Not Active — plus new leads converted from the CRM", "No prospective projects — convert a won lead or add one manually.")}
      {section("grey", "Completed / Turn-over Projects", completed, "Projects marked Turned-over move here automatically", "No turned-over projects yet.")}
    </div>
  );
}
