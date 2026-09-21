import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { Badge, Card, CardBody, CardHeader } from "@/components/ui";
import {
  AssigneeSeenList,
  InstructionReviewForm,
  InstructionUpdateForm,
} from "@/components/instruction-actions";
import { instructionProjectOrCategoryLabel } from "@/lib/instructions";

export const dynamic = "force-dynamic";

const CLOSED_STATUSES = ["COMPLETED", "CANCELLED"];

export default async function InstructionDetailPage({ params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user || user.role === "CLIENT") redirect("/projects");

  const instruction = await prisma.siteInstruction.findUnique({
    where: { id: params.id },
    include: {
      project: { select: { name: true } },
      postedBy: { select: { name: true } },
      assignees: { select: { id: true, name: true } },
      seenBy: { select: { userId: true } },
    },
  });
  if (!instruction) notFound();

  const isSupervisor = ["OWNER", "PM"].includes(user.role);
  const isAssignee = instruction.assignees.some((a) => a.id === user.id);
  const isBroadcastForForeman = instruction.assignees.length === 0 && user.role === "FOREMAN";
  // Same privacy rule as the list/board: a specifically-assigned instruction
  // is only visible to its assignees and supervisors; a broadcast (no
  // specific assignee) is still meant for the whole site team.
  const canView = isSupervisor || isAssignee || instruction.assignees.length === 0;
  if (!canView) redirect("/instructions");

  // Broadcasts have no fixed roster, so only a real assignee opening their
  // own task counts as "seen" here.
  if (isAssignee && !instruction.seenBy.some((s) => s.userId === user.id)) {
    await prisma.instructionSeen.createMany({
      data: [{ instructionId: instruction.id, userId: user.id }],
      skipDuplicates: true,
    });
    instruction.seenBy.push({ userId: user.id });
  }

  const canUpdate = isSupervisor || isAssignee || isBroadcastForForeman;
  const showReview = isSupervisor && ["FOR_REVIEW", "COMPLETED"].includes(instruction.status);
  const overdue =
    !!instruction.dueDate && instruction.dueDate < new Date() && !CLOSED_STATUSES.includes(instruction.status);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link href="/instructions" className="text-xs text-ink-400 hover:text-ink-600">
          ← All instructions
        </Link>
      </div>

      <Card>
        <CardHeader
          title={instruction.title ?? instructionProjectOrCategoryLabel(instruction)}
          subtitle={
            <>
              {instruction.taskId && <span className="font-mono">{instruction.taskId}</span>}
              {instruction.taskId && " · "}
              {instructionProjectOrCategoryLabel(instruction)} · {fmtDateTime(instruction.createdAt)} · created
              by {instruction.postedBy.name}
            </>
          }
          action={
            <div className="flex items-center gap-1.5">
              <Badge value={instruction.status} />
              <Badge value={instruction.priority} />
              {instruction.approval !== "PENDING" && <Badge value={instruction.approval} />}
            </div>
          }
        />
        <CardBody className="space-y-3">
          <p className="whitespace-pre-wrap text-sm text-ink-800">{instruction.text}</p>
          {instruction.photoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={instruction.photoUrl}
              alt=""
              className="max-h-80 rounded-lg border border-ink-100 object-cover"
            />
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-500">
            <span>
              Assigned to:{" "}
              {instruction.assignees.length > 0 ? (
                <AssigneeSeenList
                  assignees={instruction.assignees}
                  seenUserIds={instruction.seenBy.map((s) => s.userId)}
                />
              ) : (
                <span className="font-medium text-ink-700">Whole site team</span>
              )}
            </span>
            {instruction.dueDate && (
              <span className={overdue ? "font-medium text-red-600" : ""}>
                Target: {fmtDate(instruction.dueDate)}
                {overdue && " ⚠ overdue"}
              </span>
            )}
            {instruction.completedAt && (
              <span className="font-medium text-emerald-600">
                Completed: {fmtDate(instruction.completedAt)}
              </span>
            )}
          </div>
          {instruction.remarks && (
            <p className="rounded bg-ink-50 p-2 text-xs text-ink-600">📝 {instruction.remarks}</p>
          )}
          {instruction.supervisorRemarks && (
            <p className="rounded bg-brand-50 p-2 text-xs text-brand-700">
              Supervisor: {instruction.supervisorRemarks}
            </p>
          )}
        </CardBody>
      </Card>

      {canUpdate && (
        <Card>
          <CardHeader title="Update this task" subtitle="Status and progress notes — auto-saves" />
          <CardBody>
            <InstructionUpdateForm
              instructionId={instruction.id}
              status={instruction.status}
              remarks={instruction.remarks}
            />
          </CardBody>
        </Card>
      )}

      {showReview && (
        <Card>
          <CardHeader title="Supervisor review" />
          <CardBody>
            <InstructionReviewForm
              instructionId={instruction.id}
              approval={instruction.approval}
              supervisorRemarks={instruction.supervisorRemarks}
            />
          </CardBody>
        </Card>
      )}
    </div>
  );
}
