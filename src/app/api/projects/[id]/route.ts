import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";

const patchSchema = z.object({
  status: z.enum([
    "SITE_SURVEY",
    "MOBILIZATION",
    "ONGOING_CONSTRUCTION",
    "NOT_ACTIVE",
    "ON_HOLD",
    "FOR_PUNCHLIST",
    "TURNED_OVER",
  ]),
});

/**
 * PATCH /api/projects/[id] — change lifecycle status from the Projects tab
 * dropdown. TURNED_OVER moves the project into Completed/Turn-over.
 */
export const PATCH = handleApi(
  async (req: NextRequest, { params }: { params: { id: string } }) => {
    const user = await requireUser(["OWNER", "PM"]);
    const body = patchSchema.parse(await req.json());

    const project = await prisma.project.findUnique({ where: { id: params.id } });
    if (!project) throw new ApiError(404, "Project not found");
    if (project.status === body.status) return NextResponse.json(project);

    const updated = await prisma.project.update({
      where: { id: params.id },
      data: { status: body.status },
    });

    await audit({
      entityType: "Project",
      entityId: project.id,
      actorId: user.id,
      actorName: user.name,
      action: "PROJECT_STATUS_CHANGED",
      diff: { from: project.status, to: body.status },
    });

    // Turnover housekeeping: if this client has no other running projects,
    // suggest deactivating their portal access (never auto-delete — Spec §8).
    let portalSuggestion = null;
    if (body.status === "TURNED_OVER") {
      const otherActive = await prisma.project.count({
        where: {
          clientId: project.clientId,
          id: { not: project.id },
          status: { notIn: ["TURNED_OVER", "NOT_ACTIVE"] },
        },
      });
      if (otherActive === 0) {
        const portalUsers = await prisma.user.findMany({
          where: { clientId: project.clientId, role: "CLIENT", active: true },
          select: { id: true, name: true },
        });
        if (portalUsers.length > 0) {
          const client = await prisma.client.findUnique({ where: { id: project.clientId } });
          portalSuggestion = { clientName: client?.name ?? "Client", users: portalUsers };
        }
      }
    }

    return NextResponse.json({ ...updated, portalSuggestion });
  }
);

/**
 * DELETE /api/projects/[id] — Owner only, for cleaning up a mistaken or
 * duplicate project entry. Refuses if anything real is attached (payments,
 * requisitions, attendance, payroll, etc.) — a project with actual activity
 * should be marked Turned-over instead, never deleted (Spec §8 append-only).
 */
export const DELETE = handleApi(
  async (_req: NextRequest, { params }: { params: { id: string } }) => {
    const user = await requireUser(["OWNER"]);

    const project = await prisma.project.findUnique({ where: { id: params.id } });
    if (!project) throw new ApiError(404, "Project not found");

    try {
      await prisma.project.delete({ where: { id: params.id } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
        throw new ApiError(
          400,
          "This project has related records (requisitions, payments, attendance, etc.) and can't be deleted. Mark it Turned-over instead."
        );
      }
      throw err;
    }

    await audit({
      entityType: "Project",
      entityId: project.id,
      actorId: user.id,
      actorName: user.name,
      action: "PROJECT_DELETED",
      diff: { name: project.name, status: project.status },
    });

    return NextResponse.json({ ok: true });
  }
);
