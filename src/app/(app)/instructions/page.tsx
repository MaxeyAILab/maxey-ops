import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { Badge, Button, Card, CardBody, CardHeader, Input, Label, Select, Table, Td, Th } from "@/components/ui";
import {
  BoardPriorityCell,
  BoardStatusCell,
  InstructionReviewForm,
  InstructionUpdateForm,
  PostInstructionForm,
} from "@/components/instruction-actions";
import { CHARGEABLE_STATUSES } from "@/lib/project-status";
import { instructionProjectOrCategoryLabel } from "@/lib/instructions";

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
  searchParams: { from?: string; to?: string; projectId?: string; view?: string };
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

  const canUpdateFor = (i: (typeof instructions)[number]): boolean =>
    ["OWNER", "PM"].includes(user.role) ||
    i.assignedToId === user.id ||
    (!i.assignedToId && user.role === "FOREMAN");

  // Board view (Spec: spreadsheet-style, grouped by week) — same underlying
  // data as the feed, respects the active calendar/project search.
  const isBoard = searchParams.view === "board";
  const boardSource = hasFilter ? searchResults : instructions;
  function viewHref(view: "feed" | "board") {
    const params = new URLSearchParams();
    if (searchParams.from) params.set("from", searchParams.from);
    if (searchParams.to) params.set("to", searchParams.to);
    if (searchParams.projectId) params.set("projectId", searchParams.projectId);
    if (view === "board") params.set("view", "board");
    const qs = params.toString();
    return `/instructions${qs ? `?${qs}` : ""}`;
  }
  function mondayOf(d: Date): Date {
    const dateOnly = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(d);
    const utcMidnight = new Date(`${dateOnly}T00:00:00Z`);
    const dow = utcMidnight.getUTCDay(); // 0 = Sunday
    const diff = dow === 0 ? 6 : dow - 1; // days since Monday
    const monday = new Date(utcMidnight);
    monday.setUTCDate(monday.getUTCDate() - diff);
    return monday;
  }
  type Row2 = (typeof instructions)[number];
  interface WeekGroup {
    key: string;
    label: string;
    items: Row2[];
  }
  const weekMap = new Map<string, WeekGroup>();
  for (const i of boardSource) {
    const monday = mondayOf(i.createdAt);
    const key = monday.toISOString().slice(0, 10);
    let week = weekMap.get(key);
    if (!week) {
      week = { key, label: `Week of ${fmtDate(monday)}`, items: [] };
      weekMap.set(key, week);
    }
    week.items.push(i);
  }
  const weeks = Array.from(weekMap.values()).sort((a, b) => (a.key < b.key ? 1 : -1));

  const AVATAR_COLORS = ["#2563eb", "#d97706", "#059669", "#7c3aed", "#db2777", "#0891b2", "#8a1a28", "#65a30d"];
  function avatarColor(name: string): string {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    return AVATAR_COLORS[hash % AVATAR_COLORS.length];
  }
  function initials(name: string): string {
    const parts = name.trim().split(/\s+/);
    return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
  }

  const renderItem = (i: (typeof instructions)[number]) => {
    const canUpdate = canUpdateFor(i);
    const overdue = !!i.dueDate && i.dueDate < new Date() && !CLOSED_STATUSES.includes(i.status);
    const showReview = isSupervisor && ["FOR_REVIEW", "COMPLETED"].includes(i.status);

    return (
      <div key={i.id} className="rounded-lg border border-ink-100 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-xs text-ink-400">
              {instructionProjectOrCategoryLabel(i)} · {fmtDateTime(i.createdAt)} · assigned by{" "}
              {i.postedBy.name}
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
            <Badge value={i.priority} />
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
    <div className={isBoard ? "mx-auto max-w-6xl space-y-6" : "mx-auto max-w-3xl space-y-6"}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-ink-900">Site Instructions</h1>
        <div className="flex overflow-hidden rounded-lg border border-ink-200 text-sm">
          <Link
            href={viewHref("feed")}
            className={
              !isBoard
                ? "bg-brand-500 px-3 py-1.5 font-medium text-white"
                : "px-3 py-1.5 text-ink-600 hover:bg-ink-50"
            }
          >
            Feed
          </Link>
          <Link
            href={viewHref("board")}
            className={
              isBoard
                ? "bg-brand-500 px-3 py-1.5 font-medium text-white"
                : "px-3 py-1.5 text-ink-600 hover:bg-ink-50"
            }
          >
            Board
          </Link>
        </div>
      </div>

      {canPost && (
        <Card>
          <CardHeader
            title="Post an assignment"
            subtitle="Against a project, or Office/Site/Deliveries/Warehouse/Other when there's no active project — assign to one person or broadcast to the whole site team"
          />
          <CardBody>
            <PostInstructionForm projects={projects} employees={employees} />
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

      {hasFilter && !isBoard && (
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

      {isBoard && (
        <Card>
          <CardHeader
            title={`Board (${boardSource.length})`}
            subtitle="Grouped by week — status and priority auto-save on change, no separate save button"
          />
          <div className="divide-y divide-ink-100">
            {weeks.map((w) => (
              <details key={w.key} open className="group">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 hover:bg-ink-50 sm:px-5">
                  <span className="text-ink-400 transition-transform group-open:rotate-90">▶</span>
                  <span className="font-semibold text-ink-900">{w.label}</span>
                  <span className="text-xs font-normal text-ink-400">
                    ({w.items.length} assignment{w.items.length === 1 ? "" : "s"})
                  </span>
                </summary>
                <div className="border-t border-ink-100 px-4 py-2 sm:px-5">
                  <Table>
                    <thead>
                      <tr>
                        <Th>Task</Th>
                        <Th>Assigned to</Th>
                        <Th>Type</Th>
                        <Th>Status</Th>
                        <Th>Priority</Th>
                        <Th>Due date</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {w.items.map((i) => {
                        const canUpdate = canUpdateFor(i);
                        const overdue =
                          !!i.dueDate && i.dueDate < new Date() && !CLOSED_STATUSES.includes(i.status);
                        const assigneeName = i.assignedTo?.name ?? "Whole site team";
                        return (
                          <tr key={i.id} className={overdue ? "bg-red-50/40 hover:bg-red-50" : "hover:bg-ink-50"}>
                            <Td className="max-w-[240px]">
                              <span className="line-clamp-2 text-sm text-ink-800">{i.text}</span>
                            </Td>
                            <Td className="whitespace-nowrap">
                              <span className="inline-flex items-center gap-1.5">
                                <span
                                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                                  style={{ backgroundColor: avatarColor(assigneeName) }}
                                >
                                  {i.assignedTo ? initials(assigneeName) : "ST"}
                                </span>
                                <span className="text-xs text-ink-700">{assigneeName}</span>
                              </span>
                            </Td>
                            <Td className="text-xs text-ink-600">{instructionProjectOrCategoryLabel(i)}</Td>
                            <Td className="min-w-[130px]">
                              <BoardStatusCell instructionId={i.id} status={i.status} canUpdate={canUpdate} />
                            </Td>
                            <Td className="min-w-[110px]">
                              <BoardPriorityCell instructionId={i.id} priority={i.priority} canEdit={isSupervisor} />
                            </Td>
                            <Td className={overdue ? "text-xs font-medium text-red-600" : "text-xs text-ink-600"}>
                              {i.dueDate ? fmtDate(i.dueDate) : "—"}
                              {overdue && " ⚠"}
                            </Td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </Table>
                </div>
              </details>
            ))}
            {weeks.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-ink-400 sm:px-5">No assignments yet.</p>
            )}
          </div>
        </Card>
      )}

      {!isBoard && (
        <>
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
        </>
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
                        <Th>Priority</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {f.items.map((i) => (
                        <tr key={i.id} className="hover:bg-ink-50">
                          <Td className="text-xs">{fmtDateTime(i.createdAt)}</Td>
                          <Td className="text-xs">{instructionProjectOrCategoryLabel(i)}</Td>
                          <Td className="max-w-[220px]">
                            <span className="line-clamp-2 text-xs text-ink-600">{i.text}</span>
                          </Td>
                          <Td className="text-xs">{i.assignedTo?.name ?? "Whole site team"}</Td>
                          <Td className="text-xs">{i.dueDate ? fmtDate(i.dueDate) : "—"}</Td>
                          <Td>
                            <Badge value={i.status} />
                          </Td>
                          <Td>
                            <Badge value={i.priority} />
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
