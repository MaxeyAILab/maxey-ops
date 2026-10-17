import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";

const createSchema = z.object({
  name: z.string().min(1).max(200),
  code: z
    .string()
    .max(20)
    .regex(/^[A-Za-z0-9 -]*$/, "Letters, numbers, spaces, and hyphens only")
    .optional()
    .or(z.literal("")), // short code, e.g. "CTC" — prefixes this project's site instruction Task IDs
  address: z.string().max(500).optional().or(z.literal("")),
  ownerName: z.string().min(1).max(200).optional(), // project owner / client (required for a company project)
  contractValue: z.coerce.number().min(0).optional(),
  startDate: z.coerce.date().optional(),
  // A job for another organization or the owner's own property: expenses only, kept out of company operations.
  nonCorporate: z.boolean().optional(),
});

const INTERNAL_CLIENT = "Non-corporate (internal)";

/**
 * POST /api/projects — add a project manually (Projects tab "+ Add project").
 * The project owner is matched to an existing client by name, or a new client
 * record is created. New projects start as SITE_SURVEY (prospective).
 */
export const POST = handleApi(async (req: NextRequest) => {
  const user = await requireUser(["OWNER", "PM"]);
  const body = createSchema.parse(await req.json());
  if (body.nonCorporate && user.role !== "OWNER") throw new ApiError(403, "Only the Owner can add a non-corporate job");
  if (!body.nonCorporate && (!body.ownerName || body.contractValue === undefined)) {
    throw new ApiError(400, "Enter the project owner and the contract value");
  }

  const code = body.code ? body.code.trim().toUpperCase() : null;
  if (code) {
    const existingCode = await prisma.project.findUnique({ where: { code } });
    if (existingCode) throw new ApiError(400, `Project code "${code}" is already in use`);
  }

  const project = await prisma.$transaction(async (db) => {
    // A non-corporate job always belongs to one internal client record, never to a real client — so it can never show
    // up in a client's portal or be mixed into a client's figures.
    const ownerName = body.nonCorporate ? INTERNAL_CLIENT : (body.ownerName as string).trim();
    const existing = await db.client.findFirst({
      where: { name: { equals: ownerName, mode: "insensitive" } },
    });
    const client =
      existing ??
      (await db.client.create({
        data: { name: ownerName, contactName: ownerName },
      }));

    return db.project.create({
      data: {
        clientId: client.id,
        name: body.name,
        code,
        address: body.address || null,
        contractValue: body.nonCorporate ? 0 : (body.contractValue as number),
        startDate: body.startDate,
        // A non-corporate job starts as on-going so its crew, attendance and requisitions work straight away.
        status: body.nonCorporate ? "ONGOING_CONSTRUCTION" : "SITE_SURVEY",
        isNonCorporate: !!body.nonCorporate,
      },
    });
  });

  await audit({
    entityType: "Project",
    entityId: project.id,
    actorId: user.id,
    actorName: user.name,
    action: body.nonCorporate ? "NON_CORPORATE_JOB_CREATED" : "PROJECT_CREATED_MANUALLY",
    diff: { name: body.name, code, owner: body.nonCorporate ? INTERNAL_CLIENT : body.ownerName, contractValue: body.nonCorporate ? 0 : body.contractValue },
  });

  return NextResponse.json(project, { status: 201 });
});
