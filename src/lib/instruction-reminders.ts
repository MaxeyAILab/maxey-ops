import { prisma } from "@/lib/prisma";
import { notifyPeople } from "@/lib/notify-people";
import { manilaDayKey } from "@/lib/time-rules";
import { instructionProjectOrCategoryLabel } from "@/lib/instructions";
import { dueState, reminderMessage, reminderRecipients } from "@/lib/instruction-due";

const CATEGORY = "INSTRUCTIONS";

/**
 * The daily instruction reminder (runs with the 8:00 AM Manila cron): every task that is due today or past its target date and
 * not yet marked done reminds the people doing it — the assignees (a whole-team task: the foremen on its project, else whoever
 * posted it) — once a day until it is updated to For review / Completed, cancelled, or its date is extended. While an extension
 * request waits, the people doing it are not chased; the Owner and PM get one reminder to decide the waiting requests instead.
 */
export async function sendInstructionReminders(now: Date = new Date()): Promise<{ tasks: number; alerted: number; extensionRequests: number }> {
  const todayKey = manilaDayKey(now);
  const endOfToday = new Date(`${todayKey}T23:59:59.999+08:00`);
  const due = await prisma.siteInstruction.findMany({
    where: { dueDate: { lte: endOfToday }, status: { notIn: ["FOR_REVIEW", "COMPLETED", "CANCELLED"] } },
    select: {
      id: true,
      taskId: true,
      title: true,
      text: true,
      status: true,
      dueDate: true,
      projectId: true,
      category: true,
      postedById: true,
      extensionAt: true,
      project: { select: { name: true } },
      assignees: { select: { id: true } },
    },
  });

  // foremen on the projects of whole-team tasks (they are the ones who can update those)
  const projectIds = [...new Set(due.filter((t) => t.assignees.length === 0 && t.projectId).map((t) => t.projectId!))];
  const roster = projectIds.length
    ? await prisma.projectAssignment.findMany({ where: { projectId: { in: projectIds }, active: true, user: { active: true, role: "FOREMAN" } }, select: { projectId: true, userId: true } })
    : [];
  const foremenOf = (projectId: string | null) => roster.filter((r) => r.projectId === projectId).map((r) => r.userId);

  const toRemind = due.filter((t) => !t.extensionAt && dueState(manilaDayKey(t.dueDate!), todayKey, t.status)); // a waiting extension request pauses it
  let alerted = 0;
  // a few at a time, so a long list still finishes well inside the cron's time limit
  for (let i = 0; i < toRemind.length; i += 5) {
    const counts = await Promise.all(
      toRemind.slice(i, i + 5).map((t) => {
        const msg = reminderMessage({ title: t.title ?? t.text.slice(0, 60), taskId: t.taskId, where: instructionProjectOrCategoryLabel(t), dueKey: manilaDayKey(t.dueDate!), todayKey });
        return notifyPeople(reminderRecipients({ assigneeIds: t.assignees.map((a) => a.id), projectForemanIds: foremenOf(t.projectId), postedById: t.postedById }), {
          category: CATEGORY,
          title: msg.title,
          body: msg.body,
          url: `/instructions/${t.id}`,
          tag: `ins-due:${t.id}`,
        });
      }),
    );
    alerted += counts.reduce((s, n) => s + n, 0);
  }
  const tasks = toRemind.length;

  // one nudge to the Owner/PM about extension requests still waiting for a decision
  const waiting = await prisma.siteInstruction.count({ where: { extensionAt: { not: null }, status: { notIn: ["COMPLETED", "CANCELLED"] } } });
  if (waiting > 0) {
    const bosses = await prisma.user.findMany({ where: { active: true, role: { in: ["OWNER", "PM"] } }, select: { id: true } });
    alerted += await notifyPeople(
      bosses.map((b) => b.id),
      {
        category: CATEGORY,
        title: `${waiting} extension request${waiting === 1 ? "" : "s"} waiting for your decision`,
        body: "People asked for more time on their instructions. Tap to approve or reject",
        url: "/instructions?show=extension",
        tag: "ins-extensions",
      },
    );
  }
  return { tasks, alerted, extensionRequests: waiting };
}
