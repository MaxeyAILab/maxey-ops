import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";

const createSchema = z.object({
  name: z.string().min(1).max(200),
  position: z.string().min(1).max(100), // Foreman, Mason, Carpenter, Welder…
  department: z.enum(["SITE", "OFFICE", "DRIVER"]),
  dailyRate: z.coerce.number().positive().optional(),
  hourlyRate: z.coerce.number().positive().optional(),
  phone: z.string().max(30).optional().or(z.literal("")),
  email: z.string().email().optional().or(z.literal("")), // optional: not everyone logs in
  password: z.string().min(6).max(100).optional().or(z.literal("")),
  // Site workers: assign directly to a project roster on creation
  projectId: z.string().optional().or(z.literal("")),
  projectStartDate: z.coerce.date().optional(),
});

/**
 * POST /api/personnel — "Add personnel" (Attendance tab). Creates the staff
 * record used by attendance and payroll. Email/password are optional — field
 * workers who never log in get a placeholder account that cannot be guessed.
 */
export const POST = handleApi(async (req: NextRequest) => {
  const user = await requireUser(["OWNER"]); // only the Owner creates accounts
  const body = createSchema.parse(await req.json());

  if (!body.dailyRate && !body.hourlyRate) {
    throw new ApiError(400, "Provide a daily rate or an hourly rate");
  }

  // Role follows department/position; permissions stay minimal by default
  const role =
    body.department === "DRIVER"
      ? "DRIVER"
      : body.position.toLowerCase().includes("foreman")
        ? "FOREMAN"
        : "OFFICE";

  const email =
    body.email ||
    `${body.name.toLowerCase().replace(/[^a-z0-9]+/g, ".")}.${crypto.randomBytes(3).toString("hex")}@staff.maxeyconstruction.ph`;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new ApiError(400, "An account with that email already exists");

  let project = null;
  if (body.department === "SITE" && body.projectId) {
    project = await prisma.project.findUnique({ where: { id: body.projectId } });
    if (!project) throw new ApiError(400, "Unknown project");
  }

  const password = body.password || crypto.randomBytes(12).toString("hex");
  const hourlyRate = body.hourlyRate ?? Number(body.dailyRate) / 8;

  const personnel = await prisma.$transaction(async (db) => {
    const personnel = await db.user.create({
      data: {
        name: body.name,
        email,
        phone: body.phone || null,
        passwordHash: await bcrypt.hash(password, 10),
        role,
        department: body.department,
        position: body.position,
        dailyRate: body.dailyRate,
        hourlyRate: body.hourlyRate,
        // Real login (email given): force a password change on first sign-in
        mustChangePassword: !!body.email,
      },
    });
    // Straight onto the project's payroll roster (site workers)
    if (project) {
      await db.projectAssignment.create({
        data: {
          projectId: project.id,
          userId: personnel.id,
          startDate: body.projectStartDate ?? new Date(),
          hourlyRate,
        },
      });
    }
    return personnel;
  });

  await audit({
    entityType: "User",
    entityId: personnel.id,
    actorId: user.id,
    actorName: user.name,
    action: "PERSONNEL_ADDED",
    diff: {
      name: body.name,
      position: body.position,
      department: body.department,
      dailyRate: body.dailyRate ?? null,
      hourlyRate: body.hourlyRate ?? null,
      assignedProject: project?.name ?? null,
    },
  });

  return NextResponse.json(
    { id: personnel.id, name: personnel.name, email: personnel.email, project: project?.name ?? null },
    { status: 201 }
  );
});
