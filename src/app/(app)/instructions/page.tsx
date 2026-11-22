import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { CHARGEABLE_STATUSES } from "@/lib/project-status";
import { instructionProjectOrCategoryLabel } from "@/lib/instructions";
import { manilaDayKey } from "@/lib/time-rules";
import { ActionTile, CashStrip, SectionTitle } from "@/components/cash-expense-header";
import { BoardStatusCell, DeleteInstructionButton, EditInstructionForm, InstructionReviewForm, InstructionUpdateForm, AssigneeSeenList } from "@/components/instruction-actions";
import { NewAssignmentDialog } from "@/components/instruction-layout";
import { InstructionExtension } from "@/components/instruction-extension";
import { canAskExtension, dueState } from "@/lib/instruction-due";
import { ClassicInstructionsPage } from "./classic";

export const metadata = { title: "Instructions" };
export const dynamic = "force-dynamic";

const CLOSED = ["COMPLETED", "CANCELLED"];
const PRIORITY_RANK: Record<string, number> = { CRITICAL: 0, HIGH: 1, NORMAL: 2, LOW: 3 };
const PRIORITY_BAR: Record<string, string> = { CRITICAL: "bg-red-500", HIGH: "bg-orange-400", NORMAL: "bg-sky-400", LOW: "bg-ink-300" };
const PRIORITY_LABEL: Record<string, string> = { CRITICAL: "Critical", HIGH: "High", NORMAL: "Normal", LOW: "Low" };
const STATUS_LABEL: Record<string, string> = { NOT_STARTED: "Not started", IN_PROGRESS: "In progress", ON_HOLD: "On hold", FOR_REVIEW: "For review", COMPLETED: "Completed", CANCELLED: "Cancelled" };
const STATUS_TONE: Record<string, string> = {
  NOT_STARTED: "bg-ink-100 text-ink-600",
  IN_PROGRESS: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  ON_HOLD: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  FOR_REVIEW: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
  COMPLETED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  CANCELLED: "bg-ink-100 text-ink-400 line-through",
};
const BOARD_COLUMNS = ["NOT_STARTED", "IN_PROGRESS", "ON_HOLD", "FOR_REVIEW", "COMPLETED"] as const;
const AVATAR_COLORS = ["#7c3aed", "#e0144c", "#0891b2", "#d97706", "#059669", "#db2777", "#2563eb", "#65a30d"];
const avatarColor = (name: string) => {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
};
const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
const MONTH_FMT = new Intl.DateTimeFormat("en-PH", { month: "long", year: "numeric", timeZone: "Asia/Manila" });
const addDays = (key: string, n: number) => {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * Instructions — the office + site job board (owner's request 2026-11-22, same pattern as Petty Cash / Attendance / Payroll):
 * summary strip → "Needs your action" tiles → one search + filter bar → Feed (tasks folded by project / person / due date, one line
 * each, tap to open with its buttons) or Job board (status columns). The monthly archive stays at the bottom for proof to a client.
 * Who sees what and every button's permission are the same as before; the original screen stays at ?layout=classic.
 */
export default async function InstructionsPage({
  searchParams,
}: {
  searchParams: { layout?: string; view?: string; scope?: string; status?: string; show?: string; group?: string; q?: string; projectId?: string; period?: string; from?: string; to?: string };
}) {
  const user = await getSessionUser();
  if (!user || user.role === "CLIENT") redirect("/projects");
  if (searchParams.layout === "classic") return <ClassicInstructionsPage searchParams={searchParams} />;

  const isSupervisor = ["OWNER", "PM"].includes(user.role);
  const visibilityFilter = isSupervisor ? {} : { OR: [{ assignees: { none: {} } }, { assignees: { some: { id: user.id } } }] };

  const [instructions, projects, allProjects, employees] = await Promise.all([
    prisma.siteInstruction.findMany({
      where: visibilityFilter,
      orderBy: { createdAt: "desc" },
      include: {
        project: { select: { name: true } },
        postedBy: { select: { name: true } },
        assignees: { select: { id: true, name: true } },
        seenBy: { select: { userId: true } },
      },
    }),
    prisma.project.findMany({ where: { status: { in: CHARGEABLE_STATUSES } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.project.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.user.findMany({ where: { active: true, role: { not: "CLIENT" } }, select: { id: true, name: true, position: true }, orderBy: { name: "asc" } }),
  ]);

  // Opening the page counts as "seen" for the tasks given to this person (same as before).
  const myUnseen = instructions.filter((i) => i.assignees.some((a) => a.id === user.id) && !i.seenBy.some((s) => s.userId === user.id)).map((i) => i.id);
  if (myUnseen.length > 0) await prisma.instructionSeen.createMany({ data: myUnseen.map((instructionId) => ({ instructionId, userId: user.id })), skipDuplicates: true });

  type Row = (typeof instructions)[number];
  const todayKey = manilaDayKey(new Date());
  const weekEnd = addDays(todayKey, 6);
  const monthKey = todayKey.slice(0, 7);
  const dueKey = (i: Row) => (i.dueDate ? manilaDayKey(i.dueDate) : null);
  const isOpen = (i: Row) => !CLOSED.includes(i.status);
  const isOverdue = (i: Row) => isOpen(i) && !!dueKey(i) && dueKey(i)! < todayKey;
  const dueThisWeek = (i: Row) => isOpen(i) && !!dueKey(i) && dueKey(i)! >= todayKey && dueKey(i)! <= weekEnd;
  const notSeen = (i: Row) => isOpen(i) && i.assignees.length > 0 && i.assignees.some((a) => !i.seenBy.some((s) => s.userId === a.id));
  const sentBack = (i: Row) => isOpen(i) && i.approval === "NEEDS_REVISION";
  const extensionAsked = (i: Row) => isOpen(i) && !!i.extensionAt;
  // "My tasks": given to me, posted by me, or a whole-team task (those were always on everyone's list)
  const isMine = (i: Row) => i.assignees.some((a) => a.id === user.id) || i.postedById === user.id || (i.assignees.length === 0 && !isSupervisor);
  const canUpdateFor = (i: Row) => isSupervisor || i.assignees.some((a) => a.id === user.id) || (i.assignees.length === 0 && user.role === "FOREMAN");

  // ----- filters (plain GET params, so links from tiles / bookmarks work) -----
  const view = searchParams.view === "board" ? "board" : "feed";
  const scope = searchParams.scope === "mine" || searchParams.scope === "all" ? searchParams.scope : isSupervisor ? "all" : "mine";
  const show = ["overdue", "unseen", "revision", "week", "extension"].includes(searchParams.show ?? "") ? searchParams.show! : "";
  const status = ["open", "all", ...Object.keys(STATUS_LABEL)].includes(searchParams.status ?? "") ? searchParams.status! : "open";
  const group = searchParams.group === "person" || searchParams.group === "due" ? searchParams.group : "project";
  const q = (searchParams.q ?? "").trim().toLowerCase();
  const projectId = searchParams.projectId ?? "";
  // an old bookmark with ?from=&to= (the former "Search by date") opens as a custom date range
  const period = ["today", "week", "month", "custom"].includes(searchParams.period ?? "") ? searchParams.period! : searchParams.from || searchParams.to ? "custom" : "";
  const from = period === "custom" ? searchParams.from ?? "" : "";
  const to = period === "custom" ? searchParams.to ?? "" : "";
  const href = (patch: Record<string, string>) => {
    const sp = new URLSearchParams();
    const merged: Record<string, string> = { view: view === "board" ? "board" : "", scope: searchParams.scope ?? "", show, status: status === "open" ? "" : status, group: group === "project" ? "" : group, q: searchParams.q ?? "", projectId, period, from, to, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) sp.set(k, v);
    const s = sp.toString();
    return s ? `/instructions?${s}` : "/instructions";
  };

  const inScope = instructions.filter((i) => scope === "all" || isMine(i));
  const createdKey = (i: Row) => manilaDayKey(i.createdAt);
  const periodOk = (i: Row) =>
    !period ||
    (period === "today" ? createdKey(i) === todayKey : period === "week" ? createdKey(i) >= addDays(todayKey, -6) : period === "month" ? createdKey(i).startsWith(monthKey) : (!from || createdKey(i) >= from) && (!to || createdKey(i) <= to));
  const hit = (i: Row) =>
    !q || `${i.taskId ?? ""} ${i.title ?? ""} ${i.text} ${i.assignees.map((a) => a.name).join(" ")} ${instructionProjectOrCategoryLabel(i)} ${i.postedBy.name}`.toLowerCase().includes(q);
  const projectOk = (i: Row) => !projectId || (projectId.startsWith("cat-") ? !i.projectId && i.category === projectId.slice(4) : i.projectId === projectId);
  const showOk = (i: Row) => (show === "overdue" ? isOverdue(i) : show === "unseen" ? notSeen(i) : show === "revision" ? sentBack(i) : show === "week" ? dueThisWeek(i) : show === "extension" ? extensionAsked(i) : true);
  const base = inScope.filter((i) => periodOk(i) && hit(i) && projectOk(i) && showOk(i));
  const statusOk = (i: Row) => (status === "open" ? isOpen(i) : status === "all" ? true : i.status === status);
  const listed = base.filter(statusOk);
  const statusCount = (s: string) => base.filter((i) => (s === "open" ? isOpen(i) : i.status === s)).length;
  const filtered = !!(q || projectId || period || show || status !== "open");

  // ----- strip + tiles (whole scope, not the filters) -----
  const open = inScope.filter(isOpen);
  const overdue = inScope.filter(isOverdue);
  const doneMonth = inScope.filter((i) => i.status === "COMPLETED" && i.completedAt && manilaDayKey(i.completedAt).startsWith(monthKey));
  const withDue = doneMonth.filter((i) => i.dueDate);
  const onTime = withDue.filter((i) => manilaDayKey(i.completedAt!) <= dueKey(i)!).length;
  const forReview = inScope.filter((i) => i.status === "FOR_REVIEW");

  const sortRows = (rows: Row[]) =>
    [...rows].sort(
      (a, b) =>
        Number(isOverdue(b)) - Number(isOverdue(a)) ||
        Number(CLOSED.includes(a.status)) - Number(CLOSED.includes(b.status)) ||
        (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) ||
        (dueKey(a) ?? "9999").localeCompare(dueKey(b) ?? "9999") ||
        b.createdAt.getTime() - a.createdAt.getTime(),
    );

  // ----- feed groups -----
  interface Group {
    key: string;
    name: string;
    rows: Row[];
  }
  const groups: Group[] = [];
  const add = (key: string, name: string, r: Row) => {
    let g = groups.find((x) => x.key === key);
    if (!g) groups.push((g = { key, name, rows: [] }));
    g.rows.push(r);
  };
  for (const i of listed) {
    if (group === "person") {
      if (i.assignees.length === 0) add("team", "Whole site team", i);
      else for (const a of i.assignees) add(a.id, a.name, i);
    } else if (group === "due") {
      const k = !isOpen(i) ? "5" : isOverdue(i) ? "0" : !dueKey(i) ? "4" : dueKey(i) === todayKey ? "1" : dueKey(i)! <= weekEnd ? "2" : "3";
      add(k, ["Overdue", "Due today", "Due this week", "Due later", "No target date", "Closed"][Number(k)], i);
    } else add(i.projectId ?? `cat-${i.category ?? "OTHER"}`, instructionProjectOrCategoryLabel(i), i);
  }
  const heat = (g: Group) => (g.rows.some(isOverdue) ? 0 : g.rows.some((r) => r.status === "FOR_REVIEW") ? 1 : 2);
  if (group === "due") groups.sort((a, b) => a.key.localeCompare(b.key));
  else groups.sort((a, b) => heat(a) - heat(b) || b.rows.filter(isOpen).length - a.rows.filter(isOpen).length || a.name.localeCompare(b.name));

  // ----- pieces -----
  const Avatars = ({ i }: { i: Row }) =>
    i.assignees.length === 0 ? (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-500">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ink-200 text-[9px] font-bold text-ink-600">ST</span>
        <span className="hidden sm:inline">Whole team</span>
      </span>
    ) : (
      <span className="flex -space-x-1.5">
        {i.assignees.slice(0, 3).map((a) => {
          const seen = i.seenBy.some((s) => s.userId === a.id);
          return (
            <span key={a.id} title={`${a.name} · ${seen ? "seen" : "not seen yet"}`} className="relative">
              <span className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-ink-50 text-[9px] font-bold text-white" style={{ backgroundColor: avatarColor(a.name) }}>
                {initials(a.name)}
              </span>
              <span className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-ink-50 ${seen ? "bg-emerald-500" : "bg-ink-300"}`} />
            </span>
          );
        })}
        {i.assignees.length > 3 && <span className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-ink-50 bg-ink-400 text-[9px] font-bold text-white">+{i.assignees.length - 3}</span>}
      </span>
    );

  const DueChip = ({ i }: { i: Row }) => {
    const k = dueKey(i);
    if (!k) return <span className="text-[11px] text-ink-400">no date</span>;
    if (!isOpen(i)) return <span className="text-[11px] text-ink-400">{i.completedAt ? `done ${fmtDate(i.completedAt)}` : fmtDate(i.dueDate)}</span>;
    if (k < todayKey) return <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700 dark:bg-red-900/40 dark:text-red-300">⚠ {fmtDate(i.dueDate)}</span>;
    if (k === todayKey) return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">today</span>;
    return <span className="font-mono text-[11px] text-ink-500">{fmtDate(i.dueDate)}</span>;
  };

  const StatusPill = ({ s }: { s: string }) => <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_TONE[s] ?? STATUS_TONE.NOT_STARTED}`}>{STATUS_LABEL[s] ?? s}</span>;

  const Details = ({ i }: { i: Row }) => (
    <div className="space-y-2.5 pb-3 pl-4 pr-1 pt-1 text-sm sm:pl-6">
      <div className="text-[11px] text-ink-400">
        {instructionProjectOrCategoryLabel(i)} · posted {fmtDateTime(i.createdAt)} by {i.postedBy.name} · {PRIORITY_LABEL[i.priority]} priority
      </div>
      <p className="whitespace-pre-wrap text-ink-800">{i.text}</p>
      {i.photoUrl && (
        <a href={i.photoUrl} target="_blank" rel="noopener noreferrer" className="inline-block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={i.photoUrl} alt="Instruction photo" className="max-h-40 rounded-lg object-cover" />
        </a>
      )}
      <div className="text-xs text-ink-500">
        Assigned to: {i.assignees.length > 0 ? <AssigneeSeenList assignees={i.assignees} seenUserIds={i.seenBy.map((s) => s.userId)} /> : <span className="font-medium text-ink-700">Whole site team</span>}
      </div>
      <InstructionExtension
        instructionId={i.id}
        dueKey={dueKey(i)}
        todayKey={todayKey}
        state={dueState(dueKey(i), todayKey, i.status)}
        canAsk={isOpen(i) && canAskExtension({ role: user.role, isAssignee: i.assignees.some((a) => a.id === user.id), broadcast: i.assignees.length === 0 })}
        canDecide={isSupervisor && isOpen(i)}
        pending={extensionAsked(i) && i.extensionDue ? { dueKey: manilaDayKey(i.extensionDue), reason: i.extensionReason ?? "", byName: i.extensionByName ?? "—", mine: i.extensionById === user.id } : null}
        extensionCount={i.extensionCount}
        originalDueKey={i.originalDueDate ? manilaDayKey(i.originalDueDate) : null}
      />
      {i.remarks && <p className="rounded-lg bg-ink-100 p-2 text-xs text-ink-600">📝 {i.remarks}</p>}
      {i.supervisorRemarks && <p className="rounded-lg bg-brand-50 p-2 text-xs text-brand-700">Supervisor: {i.supervisorRemarks}</p>}
      {canUpdateFor(i) && <InstructionUpdateForm instructionId={i.id} status={i.status} remarks={i.remarks} />}
      {isSupervisor && ["FOR_REVIEW", "COMPLETED"].includes(i.status) && <InstructionReviewForm instructionId={i.id} approval={i.approval} supervisorRemarks={i.supervisorRemarks} />}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <Link href={`/instructions/${i.id}`} className="font-semibold text-brand-600 hover:underline">
          Open full page →
        </Link>
        {isSupervisor && (
          <>
            <EditInstructionForm
              instruction={{ id: i.id, taskId: i.taskId, title: i.title, text: i.text, projectId: i.projectId, category: i.category, assigneeIds: i.assignees.map((a) => a.id), dueDate: i.dueDate ? i.dueDate.toISOString().slice(0, 10) : "" }}
              projects={projects}
              employees={employees}
            />
            <DeleteInstructionButton instructionId={i.id} />
          </>
        )}
      </div>
    </div>
  );

  const TaskRow = ({ i }: { i: Row }) => (
    <details className="group/row border-t border-dashed border-ink-200 first:border-t-0">
      <summary className="grid cursor-pointer list-none grid-cols-[4px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-2.5 hover:bg-ink-100/40 sm:grid-cols-[4px_minmax(0,1fr)_92px_110px_104px] [&::-webkit-details-marker]:hidden">
        <span className={`row-span-2 h-full min-h-[34px] w-1 rounded-full sm:row-span-1 ${PRIORITY_BAR[i.priority] ?? "bg-ink-300"}`} title={`${PRIORITY_LABEL[i.priority]} priority`} />
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-ink-900">{i.title ?? i.text}</span>
          <span className="block truncate text-[11px] text-ink-500">
            {i.taskId && <span className="font-mono">{i.taskId} · </span>}
            {group !== "project" && `${instructionProjectOrCategoryLabel(i)} · `}
            {i.postedBy.name.split(" ")[0]}
            {sentBack(i) && <span className="font-semibold text-accent"> · sent back to fix</span>}
            {extensionAsked(i) && i.extensionDue && <span className="font-semibold text-amber-600"> · ⏳ extension asked → {fmtDate(i.extensionDue)}</span>}
          </span>
        </span>
        <span className="col-start-3 row-start-1 justify-self-end sm:col-start-auto sm:row-start-auto sm:justify-self-start">
          <Avatars i={i} />
        </span>
        <span className="col-start-2 row-start-2 sm:col-start-auto sm:row-start-auto">
          <DueChip i={i} />
        </span>
        <span className="col-start-3 row-start-2 justify-self-end sm:col-start-auto sm:row-start-auto sm:justify-self-start">
          <StatusPill s={i.status} />
        </span>
      </summary>
      <Details i={i} />
    </details>
  );

  const field = "min-h-[42px] rounded-full border border-ink-200 bg-ink-50 px-3 text-sm";
  const projectChoices = [
    ...allProjects.map((p) => ({ v: p.id, l: p.name })),
    ...["OFFICE", "SITE", "DELIVERIES", "WAREHOUSE", "OTHER"].map((c) => ({ v: `cat-${c}`, l: `${c[0]}${c.slice(1).toLowerCase()} (no project)` })),
  ];

  // ----- monthly archive (proof for a client) -----
  const months = new Map<string, Row[]>();
  for (const i of inScope) {
    const k = manilaDayKey(i.createdAt).slice(0, 7);
    months.set(k, [...(months.get(k) ?? []), i]);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-ink-900">Instructions</h1>
          <p className="text-sm text-ink-500">Assignments for the office and site teams · post, track and review in one place</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-full border border-ink-200 bg-ink-50 p-1">
            <Link href={href({ view: "" })} scroll={false} className={`fx-pill ${view === "feed" ? "fx-pill-on" : ""}`}>
              ☰ Feed
            </Link>
            <Link href={href({ view: "board" })} scroll={false} className={`fx-pill ${view === "board" ? "fx-pill-on" : ""}`}>
              ▦ Job board
            </Link>
          </div>
          {isSupervisor && <NewAssignmentDialog projects={projects} employees={employees} postedByName={user.name} />}
        </div>
      </div>

      {/* 1 — strip */}
      <CashStrip
        items={[
          { label: scope === "mine" ? "My open tasks" : "Open tasks", value: open.length, sub: `${forReview.length} waiting for review` },
          { label: "Overdue", value: overdue.length, sub: overdue.length ? `oldest ${fmtDate(overdue.reduce((a, b) => (a.dueDate! < b.dueDate! ? a : b)).dueDate)}` : "none — on schedule", tone: overdue.length ? "bad" : "good" },
          { label: "Due this week", value: inScope.filter(dueThisWeek).length, sub: `through ${fmtDate(new Date(`${weekEnd}T00:00:00Z`))}` },
          { label: `Done · ${new Date(`${monthKey}-01T00:00:00Z`).toLocaleString("en-US", { month: "short", timeZone: "UTC" })}`, value: doneMonth.length, sub: withDue.length ? `${Math.round((onTime / withDue.length) * 100)}% on time` : "no target dates", tone: "good" },
        ]}
      />

      {isSupervisor && inScope.some(extensionAsked) && (
        <Link href={href({ show: "extension", status: "", q: "", period: "" })} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <span>
            <b>⏳ {inScope.filter(extensionAsked).length} extension request{inScope.filter(extensionAsked).length === 1 ? "" : "s"}</b> waiting for your decision — {inScope.filter(extensionAsked).slice(0, 2).map((i) => i.title ?? i.text.slice(0, 40)).join(" · ")}
          </span>
          <span className="text-xs font-bold uppercase tracking-wide">Decide →</span>
        </Link>
      )}

      {/* 2 — needs your action */}
      <div>
        <SectionTitle>Needs your action</SectionTitle>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {isSupervisor ? (
            <>
              <ActionTile href={href({ status: "FOR_REVIEW", show: "", q: "", period: "" })} count={forReview.length} label="Marked done — waiting for your review" sub={forReview.slice(0, 2).map((i) => i.title ?? i.text).join(" · ")} cta="Review" />
              <ActionTile href={href({ show: "overdue", status: "", q: "", period: "" })} count={overdue.length} label="Past the target date and still open" sub={[...new Set(overdue.flatMap((i) => i.assignees.map((a) => a.name.split(" ")[0])))].slice(0, 3).join(", ")} cta="Chase" tone="warn" />
              <ActionTile href={href({ show: "unseen", status: "", q: "", period: "" })} count={inScope.filter(notSeen).length} label="Not opened yet by the person assigned" cta="Show" tone="warn" />
              <ActionTile href={href({ show: "revision", status: "", q: "", period: "" })} count={inScope.filter(sentBack).length} label="Sent back to fix — not done again yet" cta="Show" tone="warn" />
            </>
          ) : (
            <>
              <ActionTile href={href({ scope: "mine", show: "", status: "NOT_STARTED", q: "", period: "" })} count={inScope.filter((i) => i.status === "NOT_STARTED").length} label="Given to you — not started yet" cta="Start" />
              <ActionTile href={href({ scope: "mine", show: "overdue", status: "", q: "", period: "" })} count={overdue.length} label="Past the target date" cta="Update" tone="warn" />
              <ActionTile href={href({ scope: "mine", show: "week", status: "", q: "", period: "" })} count={inScope.filter(dueThisWeek).length} label="Due in the next 7 days" cta="Show" tone="warn" />
              <ActionTile href={href({ scope: "mine", show: "revision", status: "", q: "", period: "" })} count={inScope.filter(sentBack).length} label="Sent back by the supervisor to fix" cta="Fix" tone="warn" />
            </>
          )}
        </div>
      </div>

      {/* 3 — search + filters, 4 — feed or job board */}
      <section className="fx-card min-w-0 overflow-hidden rounded-2xl border border-ink-200 bg-ink-50">
        <form method="get" action="/instructions" className="flex flex-wrap items-center gap-2 border-b border-ink-100 px-3 py-3 sm:px-4">
          {view === "board" && <input type="hidden" name="view" value="board" />}
          {searchParams.scope && <input type="hidden" name="scope" value={scope} />}
          {status !== "open" && <input type="hidden" name="status" value={status} />}
          {group !== "project" && <input type="hidden" name="group" value={group} />}
          {period && period !== "custom" && <input type="hidden" name="period" value={period} />}
          <label className={`${field} flex min-w-[220px] flex-[2] items-center gap-2 px-4`}>
            <span aria-hidden className="text-ink-400">
              ⌕
            </span>
            <input name="q" defaultValue={searchParams.q ?? ""} placeholder="Find a task, Task ID or person…" className="min-w-0 flex-1 bg-transparent text-ink-900 placeholder:text-ink-400 focus:outline-none" />
          </label>
          <select name="projectId" defaultValue={projectId} aria-label="Project or category" className={`${field} min-w-[170px] flex-1`}>
            <option value="">All projects & categories</option>
            {projectChoices.map((p) => (
              <option key={p.v} value={p.v}>
                {p.l}
              </option>
            ))}
          </select>
          {period === "custom" && (
            <>
              <input type="hidden" name="period" value="custom" />
              <input type="date" name="from" defaultValue={from} aria-label="From" className={field} />
              <input type="date" name="to" defaultValue={to} aria-label="To" className={field} />
            </>
          )}
          <button type="submit" className="fx-grad min-h-[42px] rounded-full bg-accent px-5 text-sm font-semibold text-white hover:brightness-110">
            Search
          </button>
          {filtered && (
            <Link href={href({ q: "", projectId: "", period: "", from: "", to: "", show: "", status: "" })} className="px-1 text-xs font-semibold text-brand-600 hover:underline">
              Clear
            </Link>
          )}
        </form>

        {/* who + when */}
        <div className="flex items-center gap-1.5 overflow-x-auto whitespace-nowrap border-b border-ink-100 px-3 py-2.5 sm:flex-wrap sm:px-4 [&::-webkit-scrollbar]:hidden">
          <Link href={href({ scope: "mine" })} scroll={false} className={`fx-pill ${scope === "mine" ? "fx-pill-on" : ""}`}>
            My tasks
          </Link>
          <Link href={href({ scope: "all" })} scroll={false} className={`fx-pill ${scope === "all" ? "fx-pill-on" : ""}`}>
            {isSupervisor ? "Everyone" : "Everything I can see"}
          </Link>
          <span className="mx-1 h-5 w-px bg-ink-200" />
          {[
            ["", "Any time"],
            ["today", "Posted today"],
            ["week", "Last 7 days"],
            ["month", "This month"],
            ["custom", "Dates…"],
          ].map(([k, l]) => (
            <Link key={k || "any"} href={href({ period: k, from: "", to: "" })} scroll={false} className={`fx-pill ${period === k ? "fx-pill-on" : ""}`}>
              {l}
            </Link>
          ))}
          {show && (
            <Link href={href({ show: "" })} scroll={false} className="fx-pill fx-pill-on">
              {{ overdue: "Overdue", unseen: "Not seen yet", revision: "Sent back to fix", week: "Due this week", extension: "Extension requests" }[show]} ✕
            </Link>
          )}
        </div>

        {/* status (feed) / grouping */}
        {view === "feed" && (
          <div className="flex items-center gap-1.5 overflow-x-auto whitespace-nowrap border-b border-ink-100 px-3 py-2.5 sm:flex-wrap sm:px-4 [&::-webkit-scrollbar]:hidden">
            {[["open", "Open"], ["NOT_STARTED", "Not started"], ["IN_PROGRESS", "In progress"], ["ON_HOLD", "On hold"], ["FOR_REVIEW", "For review"], ["COMPLETED", "Completed"]].map(([k, l]) => (
              <Link key={k} href={href({ status: k === "open" ? "" : k })} scroll={false} className={`fx-pill ${status === k ? "fx-pill-on" : ""}`}>
                {l} <span className="ml-1 font-mono">{statusCount(k)}</span>
              </Link>
            ))}
            <Link href={href({ status: "all" })} scroll={false} className={`fx-pill ${status === "all" ? "fx-pill-on" : ""}`}>
              All
            </Link>
            <span className="flex items-center gap-1.5 pl-2 text-[11px] text-ink-400 sm:ml-auto sm:pl-0">
              Group by
              {[["project", "Project"], ["person", "Person"], ["due", "Due date"]].map(([k, l]) => (
                <Link key={k} href={href({ group: k === "project" ? "" : k })} scroll={false} className={`fx-pill ${group === k ? "fx-pill-on" : ""}`}>
                  {l}
                </Link>
              ))}
            </span>
          </div>
        )}

        {view === "feed" ? (
          groups.length === 0 ? (
            <p className="px-4 py-12 text-center text-sm text-ink-500">{filtered ? "Nothing matches — try another filter or clear the search." : "Nothing open. 🎉"}</p>
          ) : (
            groups.map((g, gi) => {
              const rows = sortRows(g.rows);
              const nOver = rows.filter(isOverdue).length;
              const nReview = rows.filter((r) => r.status === "FOR_REVIEW").length;
              const nOpen = rows.filter(isOpen).length;
              const pct = rows.length ? Math.round(((rows.length - nOpen) / rows.length) * 100) : 0;
              return (
                <details key={g.key} open={filtered || gi < 3} className="group/grp border-b border-ink-100 last:border-b-0">
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-3 hover:bg-ink-100/40 sm:flex-nowrap sm:px-4 [&::-webkit-details-marker]:hidden">
                    <span aria-hidden className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-ink-100 text-[10px] text-ink-500 transition group-open/grp:rotate-90">
                      ▶
                    </span>
                    {group === "person" && g.key !== "team" && (
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ backgroundColor: avatarColor(g.name) }}>
                        {initials(g.name)}
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-bold text-ink-900">{g.name}</span>
                      <span className="block truncate text-[11px] text-ink-500">
                        {rows.length} task{rows.length === 1 ? "" : "s"} · {nOpen} open
                      </span>
                    </span>
                    <span className="flex w-full flex-wrap items-center gap-1.5 pl-9 sm:ml-auto sm:w-auto sm:shrink-0 sm:justify-end sm:pl-0">
                      {nOver > 0 && <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-[11px] font-semibold text-red-700 dark:bg-red-900/40 dark:text-red-300">{nOver} overdue</span>}
                      {nReview > 0 && <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-[11px] font-semibold text-violet-800 dark:bg-violet-900/40 dark:text-violet-300">{nReview} for review</span>}
                      {status === "all" && (
                        <span className="flex items-center gap-1.5 text-[11px] text-ink-400">
                          <span className="h-1.5 w-16 overflow-hidden rounded-full bg-ink-200">
                            <span className="block h-full bg-emerald-500" style={{ width: `${pct}%` }} />
                          </span>
                          {pct}%
                        </span>
                      )}
                    </span>
                  </summary>
                  <div className="px-3 pb-2 sm:pl-[52px] sm:pr-4">
                    <div className="hidden grid-cols-[4px_minmax(0,1fr)_92px_110px_104px] gap-x-3 pb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-ink-400 sm:grid">
                      <span />
                      <span>Task</span>
                      <span>Assigned</span>
                      <span>Target</span>
                      <span>Status</span>
                    </div>
                    {rows.map((r) => (
                      <TaskRow key={`${g.key}-${r.id}`} i={r} />
                    ))}
                  </div>
                </details>
              );
            })
          )
        ) : (
          /* Job board: one column per status; the status box on a card moves it (saves at once) */
          <div className="overflow-x-auto p-3 sm:p-4">
            <div className="grid w-max grid-flow-col gap-3 [grid-auto-columns:minmax(260px,82vw)] sm:[grid-auto-columns:250px] xl:w-full xl:grid-flow-row xl:grid-cols-5">
              {BOARD_COLUMNS.map((col) => {
                const all = sortRows(base.filter((i) => (col === "COMPLETED" ? CLOSED.includes(i.status) : i.status === col)));
                const cards = col === "COMPLETED" && !period ? all.slice(0, 12) : all;
                return (
                  <div key={col} className="flex min-w-0 flex-col rounded-xl bg-ink-100/60 p-2">
                    <div className="flex items-center justify-between px-1.5 pb-2 pt-1">
                      <StatusPill s={col} />
                      <span className="font-mono text-xs font-bold text-ink-500">{all.length}</span>
                    </div>
                    <div className="space-y-2">
                      {cards.map((i) => (
                        <div key={i.id} className={`relative overflow-hidden rounded-xl border bg-ink-50 p-3 pl-4 shadow-sm ${isOverdue(i) ? "border-red-300" : "border-ink-200"}`}>
                          <span className={`absolute inset-y-0 left-0 w-1 ${PRIORITY_BAR[i.priority] ?? "bg-ink-300"}`} />
                          <div className="flex items-start justify-between gap-2 text-[10.5px] text-ink-400">
                            <span className="truncate font-mono">{i.taskId ?? "—"}</span>
                            <span className="shrink-0">{PRIORITY_LABEL[i.priority]}</span>
                          </div>
                          <Link href={`/instructions/${i.id}`} className="mt-1 line-clamp-2 block text-[13px] font-semibold leading-snug text-ink-900 hover:text-brand-600">
                            {i.title ?? i.text}
                          </Link>
                          <div className="mt-1 truncate text-[11px] text-ink-500">{instructionProjectOrCategoryLabel(i)}</div>
                          {extensionAsked(i) && i.extensionDue && <div className="mt-1 text-[11px] font-semibold text-amber-600">⏳ extension asked → {fmtDate(i.extensionDue)}</div>}
                          <div className="mt-2.5 flex items-center justify-between gap-2">
                            <Avatars i={i} />
                            <DueChip i={i} />
                          </div>
                          {canUpdateFor(i) && !CLOSED.includes(i.status) && (
                            <div className="mt-2.5">
                              <BoardStatusCell instructionId={i.id} status={i.status} canUpdate />
                            </div>
                          )}
                        </div>
                      ))}
                      {all.length > cards.length && (
                        <Link href={href({ view: "", status: "COMPLETED" })} className="block px-1.5 py-1 text-xs font-semibold text-brand-600 hover:underline">
                          + {all.length - cards.length} older — see all
                        </Link>
                      )}
                      {all.length === 0 && <p className="px-1.5 py-3 text-xs text-ink-400">Nothing here.</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* 5 — monthly archive: the dated record for review or proof to a client */}
      <section className="fx-card min-w-0 overflow-hidden rounded-2xl border border-ink-200 bg-ink-50">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-3 pt-3 sm:px-4">
          <h2 className="text-[10px] font-bold uppercase tracking-[0.12em] text-ink-400">Monthly archive · proof for clients</h2>
          <span className="text-[11px] text-ink-500">Every assignment ever posted · tap a month</span>
        </div>
        {[...months.entries()]
          .sort((a, b) => (a[0] < b[0] ? 1 : -1))
          .map(([k, rows]) => (
            <details key={k} className="group/m border-t border-ink-100 first:border-t-0">
              <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-3 hover:bg-ink-100/40 sm:px-4 [&::-webkit-details-marker]:hidden">
                <span aria-hidden className="text-[10px] text-ink-400 transition group-open/m:rotate-90">
                  ▶
                </span>
                <span className="flex-1 text-sm font-semibold text-ink-900">{MONTH_FMT.format(new Date(`${k}-15T00:00:00Z`))}</span>
                <span className="text-[11px] text-ink-500">
                  {rows.length} assignment{rows.length === 1 ? "" : "s"} · {rows.filter((r) => r.status === "COMPLETED").length} completed
                </span>
              </summary>
              <div className="px-3 pb-2 sm:pl-[52px] sm:pr-4">
                {/* light rows (no forms): the archive can hold hundreds of tasks — each opens its own page */}
                {[...rows]
                  .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
                  .map((i) => (
                    <Link
                      key={`m-${i.id}`}
                      href={`/instructions/${i.id}`}
                      className="grid grid-cols-[4px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-t border-dashed border-ink-200 py-2 first:border-t-0 hover:bg-ink-100/40 sm:grid-cols-[4px_96px_minmax(0,1fr)_160px_104px]"
                    >
                      <span className={`row-span-2 h-full min-h-[30px] w-1 rounded-full sm:row-span-1 ${PRIORITY_BAR[i.priority] ?? "bg-ink-300"}`} />
                      <span className="hidden font-mono text-[11px] text-ink-500 sm:block">{fmtDate(i.createdAt)}</span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-ink-900">{i.title ?? i.text}</span>
                        <span className="block truncate text-[11px] text-ink-500">
                          {i.taskId && <span className="font-mono">{i.taskId} · </span>}
                          {instructionProjectOrCategoryLabel(i)}
                          <span className="sm:hidden"> · {fmtDate(i.createdAt)}</span>
                        </span>
                      </span>
                      <span className="hidden truncate text-[11px] text-ink-600 sm:block">{i.assignees.length ? i.assignees.map((a) => a.name).join(", ") : "Whole site team"}</span>
                      <span className="col-start-3 row-span-2 row-start-1 justify-self-end sm:col-start-auto sm:row-span-1 sm:row-start-auto sm:justify-self-start">
                        <StatusPill s={i.status} />
                      </span>
                    </Link>
                  ))}
              </div>
            </details>
          ))}
      </section>

      <p className="text-center text-xs text-ink-400">
        Prefer the old screen?{" "}
        <Link href="/instructions?layout=classic" className="font-semibold text-brand-600 hover:underline">
          Open the classic layout
        </Link>
      </p>
    </div>
  );
}
