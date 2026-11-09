import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import { canApproveSheet, canReviewSheet, lineStage, nextStage } from "@/lib/timesheet";
import { dayClosedByPayroll } from "@/lib/timesheet-db";
import { alertReviewFinished } from "@/lib/timesheet-notify";

const schema = z.object({
  projectId: z.string().min(1),
  /** the Manila calendar day, e.g. "2026-11-09" */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** review = the foreman's "Checked and reviewed"; approve = the project engineer's "Approved" */
  step: z.enum(["review", "approve"]),
  checked: z.boolean(),
  /** the lines to tick (or untick); leave out to do every line of the day that can take this step */
  userIds: z.array(z.string().min(1)).max(300).optional(),
});

/**
 * POST /api/timesheet/review — the two ticks after the timekeeper has recorded a day:
 *  1. the foreman ticks "Checked and reviewed" (one line, or the box for everyone), then
 *  2. the project engineer ticks "Approved" — only for lines the foreman has already reviewed.
 * The Owner and PM may tick either. Everyone else needs to be the foreman / project engineer assigned to the project. A tick is kept
 * with who made it and when; changing a line's times, overtime or absence clears both ticks, and a day already covered by an
 * approved payroll is closed. Lines that cannot take the step are skipped and reported, never forced.
 */
export const POST = handleApi(async (req: NextRequest) => {
  const user = await requireUser();
  const body = schema.parse(await req.json());
  if (new Date(`${body.date}T00:00:00.000Z`).toISOString().slice(0, 10) !== body.date) throw new ApiError(400, "That is not a valid date");

  const project = await prisma.project.findUnique({ where: { id: body.projectId }, select: { id: true, name: true } });
  if (!project) throw new ApiError(404, "Project not found");
  const mine = await prisma.projectAssignment.findFirst({ where: { projectId: project.id, userId: user.id, active: true }, select: { id: true } });
  const ctx = { assignedToProject: !!mine };
  const allowed = body.step === "review" ? canReviewSheet(user, ctx) : canApproveSheet(user, ctx);
  if (!allowed) {
    throw new ApiError(403, body.step === "review" ? "Only the foreman of this project (or the PM / Owner) can tick “Checked and reviewed”" : "Only the project engineer of this project (or the PM / Owner) can tick “Approved”");
  }
  if (await dayClosedByPayroll(prisma, project.id, body.date)) {
    throw new ApiError(409, "Payroll for this project has already been approved for that day — its sheet is closed");
  }

  const date = new Date(`${body.date}T00:00:00.000Z`);
  const rows = await prisma.timesheetEntry.findMany({
    where: { projectId: project.id, date, ...(body.userIds ? { userId: { in: body.userIds } } : {}) },
  });
  if (rows.length === 0) throw new ApiError(400, "Nothing has been recorded on the sheet for that day yet");
  const names = new Map((await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const entries = rows.map((r) => ({ ...r, user: { name: names.get(r.userId) ?? "—" } }));

  const now = new Date();
  const done: string[] = [];
  const skipped: { userId: string; name: string; why: string }[] = [];
  for (const e of entries) {
    const move = nextStage(body.step, body.checked, lineStage(e));
    if ("error" in move) {
      // when the box for everyone is used, lines already in the wanted state are not worth mentioning
      if (!body.userIds && /^(already|not )/.test(move.error)) continue;
      skipped.push({ userId: e.userId, name: e.user.name, why: move.error });
      continue;
    }
    const data =
      body.step === "review"
        ? body.checked
          ? { reviewedById: user.id, reviewedByName: user.name, reviewedAt: now }
          : { reviewedById: null, reviewedByName: null, reviewedAt: null }
        : body.checked
          ? { engineerApprovedById: user.id, engineerApprovedByName: user.name, engineerApprovedAt: now }
          : { engineerApprovedById: null, engineerApprovedByName: null, engineerApprovedAt: null };
    // only if the line is still where we saw it (someone may have changed it a moment ago)
    const res = await prisma.timesheetEntry.updateMany({
      where: { id: e.id, reviewedAt: e.reviewedAt, engineerApprovedAt: e.engineerApprovedAt },
      data,
    });
    if (res.count === 0) skipped.push({ userId: e.userId, name: e.user.name, why: "it was just changed — reload the sheet" });
    else done.push(e.user.name);
  }

  if (done.length > 0) {
    await audit({
      entityType: "TimesheetEntry",
      entityId: entries[0].id,
      actorId: user.id,
      actorName: user.name,
      action: body.step === "review" ? (body.checked ? "TIMESHEET_REVIEWED" : "TIMESHEET_REVIEW_REMOVED") : body.checked ? "TIMESHEET_APPROVED" : "TIMESHEET_APPROVAL_REMOVED",
      diff: { project: project.name, date: body.date, workers: done, count: done.length } as never,
    });
  }
  // the foreman has now checked and reviewed the whole day: the project engineer is told it waits for his approval
  if (body.step === "review" && body.checked && done.length > 0) {
    const all = await prisma.timesheetEntry.findMany({ where: { projectId: project.id, date }, select: { reviewedAt: true } });
    if (all.length > 0 && all.every((e) => e.reviewedAt)) {
      await alertReviewFinished({ projectId: project.id, projectName: project.name, dayKey: body.date, actorId: user.id, actorName: user.name });
    }
  }
  return NextResponse.json({ ok: skipped.length === 0, changed: done.length, skipped });
});
