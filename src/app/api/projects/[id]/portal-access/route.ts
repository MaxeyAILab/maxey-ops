import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";

const createSchema = z.object({
  email: z.string().email(),
  contactName: z.string().max(200).optional().or(z.literal("")),
});

/**
 * POST /api/projects/[id]/portal-access — create the client's portal login
 * for this project's client (Project page "Portal Access" panel). Returns a
 * one-time temporary password; the client must change it on first sign-in.
 * One account serves all of the client's projects.
 */
export const POST = handleApi(
  async (req: NextRequest, { params }: { params: { id: string } }) => {
    const user = await requireUser(["OWNER"]); // only the Owner creates client accounts
    const body = createSchema.parse(await req.json());
    const email = body.email.toLowerCase().trim();

    const project = await prisma.project.findUnique({
      where: { id: params.id },
      include: { client: true },
    });
    if (!project) throw new ApiError(404, "Project not found");

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      if (existing.clientId === project.clientId && !existing.active) {
        throw new ApiError(400, "That account exists but is deactivated — reactivate it from the People page");
      }
      throw new ApiError(400, "An account with that email already exists");
    }

    const tempPassword = crypto.randomBytes(5).toString("hex"); // 10 chars, one-time
    const portalUser = await prisma.user.create({
      data: {
        name: body.contactName || project.client.contactName || project.client.name,
        email,
        passwordHash: await bcrypt.hash(tempPassword, 10),
        role: "CLIENT",
        clientId: project.clientId,
        mustChangePassword: true,
      },
    });

    await audit({
      entityType: "User",
      entityId: portalUser.id,
      actorId: user.id,
      actorName: user.name,
      action: "PORTAL_ACCESS_CREATED",
      diff: { client: project.client.name, project: project.name, email },
    });

    // tempPassword is returned exactly once and never stored in plain text
    return NextResponse.json(
      { id: portalUser.id, name: portalUser.name, email, tempPassword },
      { status: 201 }
    );
  }
);
