import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { notifyUser } from "@/lib/notify-user";
import { savePhotos } from "@/lib/storage";
import { parseDates } from "@/lib/date-input";
import { canRaiseRfi, formatRfiNumber } from "@/lib/rfi";
import { assertLinksBelongToProject, assertRfiAssignee } from "@/lib/rfi-links";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";

const createSchema = z.object({
  projectId: z.string().min(1),
  clientUuid: z.string().uuid().optional(),
  submittedAt: z.coerce.date().optional(), // device time, from the offline outbox
  subject: z.string().trim().min(3).max(200),
  question: z.string().trim().min(3).max(5000),
  addressedTo: z.enum(["INTERNAL", "CLIENT"]).default("INTERNAL"),
  assigneeId: z.string().optional().nullable(),
  dueDate: z.string().optional().nullable(),
  workItem: z.string().max(200).optional().nullable(),
  dailyReportNo: z.string().max(40).optional().nullable(),
  milestoneId: z.string().optional().nullable(),
  documentId: z.string().optional().nullable(),
  photos: z.array(z.string()).max(4).optional(),
});

/**
 * POST /api/rfis — raise a request for information. Foremen can raise
 * internal RFIs; sending one to the client is a PM/Owner action. The number
 * (RFI-001, RFI-002...) is sequential per project; a unique constraint plus a
 * short retry keeps two simultaneous RFIs from ever sharing one.
 */
export const POST = handleApi(async (req: NextRequest) => {
  const user = await requireUser(["OWNER", "PM", "FOREMAN"]);
  const body = createSchema.parse(await req.json());
  if (!canRaiseRfi(user.role, body.addressedTo)) {
    throw new ApiError(403, "Only the PM or Owner can send an RFI to the client");
  }

  if (body.clientUuid) {
    const existing = await prisma.rfi.findUnique({ where: { clientUuid: body.clientUuid }, select: { id: true } });
    if (existing) return NextResponse.json({ error: "Already synced", id: existing.id }, { status: 409 });
  }

  const project = await prisma.project.findUnique({
    where: { id: body.projectId },
    select: { id: true, name: true, client: { select: { name: true, email: true, phone: true } } },
  });
  if (!project) throw new ApiError(404, "Project not found");

  const { dueDate } = parseDates(body, ["dueDate"]);
  await assertLinksBelongToProject(body.projectId, { milestoneId: body.milestoneId, documentId: body.documentId });
  if (body.addressedTo === "INTERNAL" && body.assigneeId) await assertRfiAssignee(body.assigneeId);

  const photos = await savePhotos(body.photos);

  for (let attempt = 0; attempt < 4; attempt++) {
    const max = await prisma.rfi.aggregate({ where: { projectId: body.projectId }, _max: { number: true } });
    const number = (max._max.number ?? 0) + 1;
    try {
      const rfi = await prisma.rfi.create({
        data: {
          projectId: body.projectId,
          number,
          clientUuid: body.clientUuid,
          subject: body.subject,
          question: body.question,
          addressedTo: body.addressedTo,
          assigneeId: body.addressedTo === "INTERNAL" ? body.assigneeId || null : null,
          dueDate,
          workItem: body.workItem || null,
          dailyReportNo: body.dailyReportNo || null,
          milestoneId: body.milestoneId || null,
          documentId: body.documentId || null,
          photos: photos.length ? photos : undefined,
          raisedById: user.id,
          ...(body.submittedAt ? { createdAt: body.submittedAt } : {}),
        },
      });
      await audit({
        entityType: "Rfi",
        entityId: rfi.id,
        actorId: user.id,
        actorName: user.name,
        action: "RFI_RAISED",
        diff: { project: project.name, number: formatRfiNumber(number), subject: body.subject, addressedTo: body.addressedTo },
      });
      // Short, neutral messages — the detail stays in the app, where permissions are enforced.
      if (body.addressedTo === "INTERNAL" && body.assigneeId && body.assigneeId !== user.id) {
        await notifyUser(body.assigneeId, "An RFI was assigned to you", `${formatRfiNumber(number)} on ${project.name} needs your answer — open Maxey Ops.`);
      }
      if (body.addressedTo === "CLIENT") {
        await notify({
          to: { name: project.client.name, email: project.client.email, phone: project.client.phone },
          subject: "A question from Maxey Construction",
          message: `${formatRfiNumber(number)} on ${project.name} needs your answer — please open your Maxey Construction client portal.`,
        });
      }
      return NextResponse.json(rfi, { status: 201 });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        if (body.clientUuid) {
          const existing = await prisma.rfi.findUnique({ where: { clientUuid: body.clientUuid }, select: { id: true } });
          if (existing) return NextResponse.json({ error: "Already synced", id: existing.id }, { status: 409 });
        }
        continue; // number taken — retry
      }
      throw err;
    }
  }
  throw new ApiError(409, "Couldn't allocate an RFI number — please try again");
});
