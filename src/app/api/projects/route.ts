import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { handleApi, requireUser } from "@/lib/rbac";

const createSchema = z.object({
  name: z.string().min(1).max(200),
  address: z.string().max(500).optional().or(z.literal("")),
  ownerName: z.string().min(1).max(200), // project owner / client
  contractValue: z.coerce.number().min(0),
  startDate: z.coerce.date().optional(),
});

/**
 * POST /api/projects — add a project manually (Projects tab "+ Add project").
 * The project owner is matched to an existing client by name, or a new client
 * record is created. New projects start as SITE_SURVEY (prospective).
 */
export const POST = handleApi(async (req: NextRequest) => {
  const user = await requireUser(["OWNER", "PM"]);
  const body = createSchema.parse(await req.json());

  const project = await prisma.$transaction(async (db) => {
    const existing = await db.client.findFirst({
      where: { name: { equals: body.ownerName.trim(), mode: "insensitive" } },
    });
    const client =
      existing ??
      (await db.client.create({
        data: { name: body.ownerName.trim(), contactName: body.ownerName.trim() },
      }));

    return db.project.create({
      data: {
        clientId: client.id,
        name: body.name,
        address: body.address || null,
        contractValue: body.contractValue,
        startDate: body.startDate,
        status: "SITE_SURVEY",
      },
    });
  });

  await audit({
    entityType: "Project",
    entityId: project.id,
    actorId: user.id,
    actorName: user.name,
    action: "PROJECT_CREATED_MANUALLY",
    diff: { name: body.name, owner: body.ownerName, contractValue: body.contractValue },
  });

  return NextResponse.json(project, { status: 201 });
});
