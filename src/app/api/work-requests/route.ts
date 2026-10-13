import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { notifyOwner } from "@/lib/notify";
import { savePhotos } from "@/lib/storage";
import { MAX_OPEN_REQUESTS_PER_PROJECT, canSubmitWorkRequest, formatWorkRequestNumber } from "@/lib/work-requests";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";

const createSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().min(3).max(5000),
  photos: z.array(z.string()).max(4).optional(),
});

/**
 * POST /api/work-requests — a client asks for additional work from their
 * portal. This only records the request: it carries no price, creates no
 * change order and never touches the contract value. A client can only submit
 * on a project that belongs to their own client account (anything else looks
 * like "project not found").
 */
export const POST = handleApi(async (req: NextRequest) => {
  const user = await requireUser(["CLIENT"]);
  const body = createSchema.parse(await req.json());

  const project = await prisma.project.findUnique({
    where: { id: body.projectId },
    select: { id: true, name: true, clientId: true },
  });
  if (!project || !canSubmitWorkRequest({ id: user.id, role: user.role, clientId: user.clientId }, project.clientId)) {
    throw new ApiError(404, "Project not found");
  }

  const open = await prisma.workRequest.count({
    where: { projectId: project.id, status: { in: ["REQUESTED", "UNDER_REVIEW"] } },
  });
  if (open >= MAX_OPEN_REQUESTS_PER_PROJECT) {
    throw new ApiError(400, "You already have several requests waiting on our team for this project — please wait for a reply before sending more");
  }

  const photos = await savePhotos(body.photos);

  for (let attempt = 0; attempt < 4; attempt++) {
    const max = await prisma.workRequest.aggregate({ where: { projectId: project.id }, _max: { number: true } });
    const number = (max._max.number ?? 0) + 1;
    try {
      const wr = await prisma.workRequest.create({
        data: {
          projectId: project.id,
          number,
          title: body.title,
          description: body.description,
          photos: photos.length ? photos : undefined,
          requestedById: user.id,
        },
      });
      await audit({
        entityType: "WorkRequest",
        entityId: wr.id,
        actorId: user.id,
        actorName: user.name,
        action: "WORK_REQUEST_SUBMITTED",
        diff: { project: project.name, number: formatWorkRequestNumber(number), title: body.title },
      });
      await notifyOwner("Additional work requested", `${user.name} requested “${body.title}” on ${project.name}`);
      return NextResponse.json({ id: wr.id, number: formatWorkRequestNumber(number) }, { status: 201 });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue; // number taken — retry
      throw err;
    }
  }
  throw new ApiError(409, "Couldn't save your request — please try again");
});
