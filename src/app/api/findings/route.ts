import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { notifyUser } from "@/lib/notify-user";
import { savePhotos } from "@/lib/storage";
import { parseDates } from "@/lib/date-input";
import { canRaiseFinding, formatFindingNumber, isRestrictedType } from "@/lib/findings";
import { assertActiveStaff } from "@/lib/rfi-links";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";

const createSchema = z.object({
  projectId: z.string().min(1),
  clientUuid: z.string().uuid().optional(),
  submittedAt: z.coerce.date().optional(), // device time, from the offline outbox
  type: z.enum(["DEFECT", "PUNCH_ITEM", "INSPECTION", "SAFETY_OBSERVATION", "INCIDENT"]),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().min(3).max(5000),
  location: z.string().trim().max(200).optional().nullable(),
  workItem: z.string().trim().max(200).optional().nullable(),
  ownerId: z.string().optional().nullable(),
  dueDate: z.string().optional().nullable(),
  photos: z.array(z.string()).max(4).optional(),
});

/**
 * POST /api/findings — raise a quality or safety finding (defect, punch item, inspection
 * finding, safety observation or incident). Owner, PM and foremen can raise one. Incidents
 * are restricted from the start. Safe to retry from the offline outbox: clientUuid makes a
 * repeat return 409 "already synced". The number (QS-001...) is allocated under a unique
 * constraint with a short retry, so two simultaneous findings never share one.
 */
export const POST = handleApi(async (req: NextRequest) => {
  const user = await requireUser(["OWNER", "PM", "FOREMAN"]);
  const body = createSchema.parse(await req.json());
  if (!canRaiseFinding(user.role)) throw new ApiError(403, "Not authorized for this action");

  if (body.clientUuid) {
    const existing = await prisma.finding.findUnique({ where: { clientUuid: body.clientUuid }, select: { id: true } });
    if (existing) return NextResponse.json({ error: "Already synced", id: existing.id }, { status: 409 });
  }

  const project = await prisma.project.findUnique({ where: { id: body.projectId }, select: { id: true, name: true } });
  if (!project) throw new ApiError(404, "Project not found");
  const { dueDate } = parseDates(body, ["dueDate"]);
  if (body.ownerId) await assertActiveStaff(body.ownerId, "The person responsible");

  const photos = await savePhotos(body.photos);
  const restricted = isRestrictedType(body.type);

  for (let attempt = 0; attempt < 4; attempt++) {
    const max = await prisma.finding.aggregate({ where: { projectId: body.projectId }, _max: { number: true } });
    const number = (max._max.number ?? 0) + 1;
    try {
      const finding = await prisma.finding.create({
        data: {
          projectId: body.projectId,
          number,
          clientUuid: body.clientUuid,
          type: body.type,
          severity: body.severity,
          title: body.title,
          description: body.description,
          location: body.location || null,
          workItem: body.workItem || null,
          ownerId: body.ownerId || null,
          dueDate,
          restricted,
          photos: photos.length ? photos : undefined,
          raisedById: user.id,
          ...(body.submittedAt ? { createdAt: body.submittedAt } : {}),
        },
      });
      await audit({
        entityType: "Finding",
        entityId: finding.id,
        actorId: user.id,
        actorName: user.name,
        action: "FINDING_RAISED",
        // A restricted finding's title never goes into the general audit feed.
        diff: { project: project.name, number: formatFindingNumber(number), type: body.type, severity: body.severity, ...(restricted ? {} : { title: body.title }) },
      });
      if (body.ownerId && body.ownerId !== user.id) {
        await notifyUser(body.ownerId, "A finding was assigned to you", `${formatFindingNumber(number)} on ${project.name} — open Maxey Ops to see it.`);
      }
      return NextResponse.json({ id: finding.id, number: formatFindingNumber(number) }, { status: 201 });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        if (body.clientUuid) {
          const existing = await prisma.finding.findUnique({ where: { clientUuid: body.clientUuid }, select: { id: true } });
          if (existing) return NextResponse.json({ error: "Already synced", id: existing.id }, { status: 409 });
        }
        continue; // number taken — retry
      }
      throw err;
    }
  }
  throw new ApiError(409, "Couldn't allocate a finding number — please try again");
});
