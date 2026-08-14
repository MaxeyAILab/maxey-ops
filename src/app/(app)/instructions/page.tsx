import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { Badge, Button, Card, CardBody, CardHeader, Input, Label, Select, Table, Td, Th } from "@/components/ui";
import {
  InstructionReviewForm,
  InstructionUpdateForm,
  PostInstructionForm,
} from "@/components/instruction-actions";
import { CHARGEABLE_STATUSES } from "@/lib/project-status";

export const metadata = { title: "Site Instructions" };
export const dynamic = "force-dynamic";

const CLOSED_STATUSES = ["COMPLETED", "CANCELLED"];

const MONTH_FMT = new Intl.DateTimeFormat("en-PH", {
  month: "long",
  year: "numeric",
  timeZone: "Asia/Manila",
});

/**
 * Site instructions / assignments (Spec 6.6): a running daily list on the
 * foreman's device — not a buried chat thread — with per-person assignment,
 * a target date, a status the assignee controls, and a supervisor review
 * layer independent of that status. Also archived monthly and searchable by
 * date range/project, since these double as dated proof for a client.
 */
export default async function InstructionsPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string; projectId?: string };
}) {
  const user = await getSessionUser();
  if (!user || user.role === "CLIENT") redirect("/projects");

  const [instructions, projects, allProjects, employees] = await Promise.all([
    prisma.siteInstruction.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        project: { select: { name: true } },
        postedBy: { select: { name: true } },
        assignedTo: { select: { id: true, name: true } },
      },
    }),
    prisma.project.findMany({
      where: { status: { in: CHARGEABLE_STATUSES } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    // Search covers finished/turned-over projects too — that's often exactly
    // what a client wants proof from.
    prisma.project.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      where: { active: true, role: { not: "CLIENT" } },
      select: { id: true, name: true, position: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const canPost = ["OWNER", "PM"].includes(user.role);
  const isSupervisor = ["OWNER", "PM"].includes(user.role);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const today = instructions.filter((i) => i.createdAt >= startOfToday);
  const open = instructions.filter(
    (i) => i.createdAt < startOfToday && !CLOSED_STATUSES.includes(i.status)
  );
  const done = instructions.filter(
    (i) => i.createdAt < startOfToday && CLOSED_STATUSES.includes(i.status)
  );

  // Calendar search — plain GET params so it works with no client JS, and a
  // link is shareable/bookmarkable for pulling up the same proof again.
  const fromDate = searchParams.from ? new Date(`${searchParams.from}T00:00:00.000+08:00`) : null;
  const toDate = searchParams.to ? new Date(`${searchParams.to}T23:59:59.999+08:00`) : null;
  const projectFilter = searchParams.projectId || "";
  const hasFilter = !!(fromDate || toDate || projectFilter);
  const searchResults = hasFilter
    ? instructions.filter((i) => {
        if (fromDate && i.createdAt < fromDate) return false;
        if (toDate && i.createdAt > toDate) return false;
        if (projectFilter && i.projectId !== projectFilter) return false;
        return true;
      })
    : [];

  // Archive every assignment ever posted into monthly folders — the running
  // record to hand a client or pull up for review.
  type Row = (typeof instructions)[number];
  interface Folder {
    key: string;
    label: string;
    count: number;
    completedCount: number;
    items: Row[];
  }
  const folderMap = new Map<string, Folder>();
  for (const i of instructions) {
    const d = i.createdAt;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    let folder = folderMap.get(key);
    if (!folder) {
      folder = { key, label: MONTH_FMT.format(d), count: 0, completedCount: 0, items: [] };
      folderMap.set(key, folder);
    }
    folder.count += 1;
    if (i.status === "COMPLETED") folder.completedCount += 1;
    folder.items.push(i);
  }
  const folders = Array.from(folderMap.values()).sort((a, b) => (a.key < b.key ? 1 : -1));

  const renderItem = (i: (typeof instructions)[number]) => {
    const canUpdate =
      ["OWNER", "PM"].includes(user.role) ||
      i.assignedToId === user.id ||
      (!i.assignedToId && user.role === "FOREMAN");
    const overdue = !!i.dueDate && i.dueDate < new Date() && !CLOSED_STATUSES.includes(i.status);
    const showReview = isSupervisor && ["FOR_REVIEW", "COMPLETED"].includes(i.status);

    return (
      <div key={i.id} className="rounded-lg border border-ink-100 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-xs text-ink-400">
              {i.project.name} · {fmtDateTime(i.createdAt)} · assigned by {i.postedBy.name}
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-ink-800">{i.text}</p>
            {i.photoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={i.photoUrl} alt="" className="mt-2 max-h-40 rounded-lg object-cover" />
            )}
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-500">
              <span>
                Assigned to:{" "}
                <span className="font-medium text-ink-700">
                  {i.assignedTo?.name ?? "Whole site team"}
                </span>
              </span>
              {i.dueDate && (
                <span className={overdue ? "font-medium text-red-600" : ""}>
                  Target: {fmtDate(i.dueDate)}
                  {overdue && " ⚠ overdue"}
                </span>
              )}
              {i.completedAt && (
                <span className="font-medium text-emerald-600">
                  Completed: {fmtDate(i.completedAt)}
                </span>
              )}
            </div>
            {i.remarks && (
              <p className="mt-1.5 rounded bg-ink-50 p-2 text-xs text-ink-600">📝 {i.remarks}</p>
            )}
            {i.supervisorRemarks && (
              <p className="mt-1.5 rounded bg-brand-50 p-2 text-xs text-brand-700">
                Supervisor: {i.supervisorRemarks}
              </p>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <Badge value={i.status} />
            {i.approval !== "PENDING" && <Badge value={i.approval} />}
          </div>
        </div>
        {canUpdate && (
          <div className="mt-3">
            <InstructionUpdateForm instructionId={i.id} status={i.status} remarks={i.remarks} />
          </div>
        )}
        {showReview && (
          <div className="mt-3">
            <InstructionReviewForm
              instructionId={i.id}
              approval={i.approval}
              supervisorRemarks={i.supervisorRemarks}
            />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-xl font-bold text-ink-900">Site Instructions</h1>

      {canPost && (
        <Card>
          <CardHeader
            title="Post an assignment"
            subtitle="Assign to one person with a target date, or broadcast to the whole site team"
          />
          <CardBody>
            {projects.length > 0 ? (
              <PostInstructionForm projects={projects} employees={employees} />
            ) : (
              <p className="text-sm text-ink-400">No active projects.</p>
            )}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader
          title="Search by date"
          subtitle="Pull up assignments for a date range — handy for review or proof to a client"
        />
        <CardBody>
          <form method="get" className="flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="searchFrom">From</Label>
              <Input id="searchFrom" name="from" type="date" defaultValue={searchParams.from ?? ""} />
            </div>
            <div>
              <Label htmlFor="searchTo">To</Label>
              <Input id="searchTo" name="to" type="date" defaultValue={searchParams.to ?? ""} />
            </div>
            <div>
              <Label htmlFor="searchProject">Project</Label>
              <Select id="searchProject" name="projectId" defaultValue={searchParams.projectId ?? ""}>
                <option value="">All projects</option>
                {allProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit">Search</Button>
            {hasFilter && (
              <Link href="/instructions" className="text-xs text-ink-400 hover:text-ink-600">
                Clear
              </Link>
            )}
          </form>
        </CardBody>
      </Card>

      {hasFilter && (
        <Card>
          <CardHeader
            title={`Search results (${searchResults.length})`}
            subtitle={
              [
                searchParams.from ? `From ${fmtDate(fromDate)}` : null,
                searchParams.to ? `To ${fmtDate(toDate)}` : null,
                projectFilter ? allProjects.find((p) => p.id === projectFilter)?.name : null,
              ]
                .filter(Boolean)
                .join(" · ") || "All assignments"
            }
          />
          <CardBody className="space-y-3">
            {searchResults.map(renderItem)}
            {searchResults.length === 0 && (
              <p className="text-sm text-ink-400">No assignments found for this range.</p>
            )}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title={`Today (${today.length})`} subtitle="Assignments issued today" />
        <CardBody className="space-y-3">
          {today.map(renderItem)}
          {today.length === 0 && <p className="text-sm text-ink-400">Nothing new today.</p>}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={`Still open (${open.length})`}
          subtitle="Earlier assignments not yet done — surfaced until closed"
        />
        <CardBody className="space-y-3">
          {open.map(renderItem)}
          {open.length === 0 && <p className="text-sm text-ink-400">Nothing outstanding.</p>}
        </CardBody>
      </Card>

      {done.length > 0 && (
        <Card>
          <CardHeader title={`Completed (${done.length})`} />
          <CardBody className="space-y-3">{done.slice(0, 20).map(renderItem)}</CardBody>
        </Card>
      )}

      {folders.length > 0 && (
        <Card>
          <CardHeader
            title="All assignments — by month"
            subtitle="Every instruction ever posted, archived by month — the full record for review or proof"
          />
          <div className="divide-y divide-ink-100">
            {folders.map((f) => (
              <details key={f.key} className="group">
                <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-ink-50 sm:px-5">
                  <div className="flex items-center gap-2">
                    <span className="text-ink-400 transition-transform group-open:rotate-90">▶</span>
                    <span className="font-semibold text-ink-900">{f.label}</span>
                  </div>
                  <span className="text-xs font-medium text-ink-500">
                    {f.count} assignment{f.count === 1 ? "" : "s"} · {f.completedCount} completed
                  </span>
                </summary>
                <div className="border-t border-ink-100 px-4 py-2 sm:px-5">
                  <Table>
                    <thead>
                      <tr>
                        <Th>Date</Th>
                        <Th>Project</Th>
                        <Th>Assignment</Th>
                        <Th>Assigned to</Th>
                        <Th>Target</Th>
                        <Th>Status</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {f.items.map((i) => (
                        <tr key={i.id} className="hover:bg-ink-50">
                          <Td className="text-xs">{fmtDateTime(i.createdAt)}</Td>
                          <Td className="text-xs">{i.project.name}</Td>
                          <Td className="max-w-[220px]">
                            <span className="line-clamp-2 text-xs text-ink-600">{i.text}</span>
                          </Td>
                          <Td className="text-xs">{i.assignedTo?.name ?? "Whole site team"}</Td>
                          <Td className="text-xs">{i.dueDate ? fmtDate(i.dueDate) : "—"}</Td>
                          <Td>
                            <Badge value={i.status} />
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              </details>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
