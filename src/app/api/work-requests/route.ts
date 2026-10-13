import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { notifyOwner } from "@/lib/notify";
import { savePhotos } from "@/lib/storage";
import { parseDates } from "@/lib/date-input";
import { manilaToday } from "@/lib/milestones";
import {
  MAX_OPEN_REQUESTS_PER_PROJECT,
  SOURCE_LABEL,
  canRecordClientInstruction,
  canSubmitWorkRequest,
  formatWorkRequestNumber,
  validateInstructedOn,
} from "@/lib/work-requests";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";

const createSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().min(3).max(5000),
  photos: z.array(z.string()).max(4).optional(),
  kind: z.enum(["ADDITION", "CHANGE", "REDUCTION"]).default("ADDITION"),
  // Only used when staff record an instruction the client gave outside the portal:
  source: z.enum(["PHONE", "MESSAGE", "EMAIL", "MEETING", "SITE"]).optional(),
  instructedByName: z.string().trim().min(2).max(120).optional(),
  instructedOn: z.string().optional().nullable(),
  clientUuid: z.string().min(8).max(80).optional(),
});

/**
 * POST /api/work-requests — one door for a client instruction:
 *  - a client sends it from their portal (source PORTAL), or
 *  - the Owner / PM / Foreman writes down one the client gave by phone, message,
 *    email, meeting or on site, with who gave it and on which day.
 * Either way this only records the instruction: it carries no price, creates no
 * change order and never touches the contract value. A client can only submit
 * on a project that belongs to their own client account (anything else looks
 * like "project not found"). Recording on site is offline-safe: a repeated
 * clientUuid returns 409 "Already synced".
 */
export const POST = handleApi(async (req: NextRequest) => {
  const user = await requireUser(["CLIENT", "OWNER", "PM", "FOREMAN"]);
  const body = createSchema.parse(await req.json());
  const byStaff = user.role !== "CLIENT";

  if (body.clientUuid) {
    const existing = await prisma.workRequest.findUnique({ where: { clientUuid: body.clientUuid }, select: { id: true } });
    if (existing) return NextResponse.json({ error: "Already synced", id: existing.id }, { status: 409 });
  }

  const project = await prisma.project.findUnique({
    where: { id: body.projectId },
    select: { id: true, name: true, clientId: true },
  });
  if (!project) throw new ApiError(404, "Project not found");

  let source: "PORTAL" | "PHONE" | "MESSAGE" | "EMAIL" | "MEETING" | "SITE" = "PORTAL";
  let instructedByName: string | null = null;
  let instructedOn: Date | null = null;
  if (byStaff) {
    if (!canRecordClientInstruction(user.role)) throw new ApiError(403, "Not authorized for this action");
    if (!body.source) throw new ApiError(400, "Say how the client gave the instruction (phone, message, email, meeting or on site)");
    if (!body.instructedByName) throw new ApiError(400, "Enter who at the client gave the instruction");
    source = body.source;
    instructedByName = body.instructedByName;
    const { instructedOn: parsed } = parseDates(body, ["instructedOn"]);
    const problem = validateInstructedOn(parsed, new Date());
    if (problem) throw new ApiError(400, `instructedOn: ${problem}`);
    instructedOn = parsed ?? new Date(manilaToday(new Date()) * 86_400_000);
  } else {
    if (!canSubmitWorkRequest({ id: user.id, role: user.role, clientId: user.clientId }, project.clientId)) {
      throw new ApiError(404, "Project not found");
    }
    const open = await prisma.workRequest.count({
      where: { projectId: project.id, status: { in: ["REQUESTED", "UNDER_REVIEW"] }, source: "PORTAL" },
    });
    if (open >= MAX_OPEN_REQUESTS_PER_PROJECT) {
      throw new ApiError(400, "You already have several requests waiting on our team for this project — please wait for a reply before sending more");
    }
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
          kind: body.kind,
          source,
          instructedByName,
          instructedOn,
          clientUuid: body.clientUuid ?? null,
        },
      });
      await audit({
        entityType: "WorkRequest",
        entityId: wr.id,
        actorId: user.id,
        actorName: user.name,
        action: byStaff ? "WORK_REQUEST_RECORDED" : "WORK_REQUEST_SUBMITTED",
        diff: {
          project: project.name,
          number: formatWorkRequestNumber(number),
          title: body.title,
          kind: body.kind,
          source,
          ...(byStaff ? { instructedBy: instructedByName, instructedOn: instructedOn?.toISOString().slice(0, 10) } : {}),
        },
      });
      if (!byStaff) {
        await notifyOwner("Client request", `${user.name} sent “${body.title}” on ${project.name}`);
      } else if (user.role !== "OWNER") {
        await notifyOwner("Client instruction recorded", `${user.name} recorded “${body.title}” (${SOURCE_LABEL[source].toLowerCase()} from ${instructedByName}) on ${project.name}`);
      }
      return NextResponse.json({ id: wr.id, number: formatWorkRequestNumber(number) }, { status: 201 });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue; // number taken — retry
      throw err;
    }
  }
  throw new ApiError(409, "Couldn't save your request — please try again");
});
