import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  position: z.string().min(1).max(100).optional(),
  dailyRate: z.coerce.number().positive().optional(),
  hourlyRate: z.coerce.number().positive().optional(),
  phone: z.string().max(30).optional().or(z.literal("")),
  email: z.string().email().optional().or(z.literal("")),
});

/**
 * PATCH /api/personnel/[id] — edit personnel details (name, position, rate,
 * contact info). Project assignment/department changes stay in the Payroll
 * tab, which already owns that workflow.
 */
export const PATCH = handleApi(
  async (req: NextRequest, { params }: { params: { id: string } }) => {
    const user = await requireUser(["OWNER"]); // only the Owner edits accounts
    const body = updateSchema.parse(await req.json());

    const target = await prisma.user.findUnique({ where: { id: params.id } });
    if (!target) throw new ApiError(404, "Personnel not found");

    let email = target.email;
    if (body.email && body.email !== target.email) {
      const existing = await prisma.user.findUnique({ where: { email: body.email } });
      if (existing) throw new ApiError(400, "An account with that email already exists");
      email = body.email;
    }

    let dailyRate = target.dailyRate;
    let hourlyRate = target.hourlyRate;
    if (body.dailyRate !== undefined) {
      dailyRate = body.dailyRate as unknown as typeof dailyRate;
      hourlyRate = (body.hourlyRate ?? body.dailyRate / 8) as unknown as typeof hourlyRate;
    } else if (body.hourlyRate !== undefined) {
      hourlyRate = body.hourlyRate as unknown as typeof hourlyRate;
    }

    const updated = await prisma.user.update({
      where: { id: target.id },
      data: {
        name: body.name ?? target.name,
        position: body.position ?? target.position,
        phone: body.phone !== undefined ? body.phone || null : target.phone,
        email,
        dailyRate,
        hourlyRate,
      },
    });

    await audit({
      entityType: "User",
      entityId: target.id,
      actorId: user.id,
      actorName: user.name,
      action: "PERSONNEL_UPDATED",
      diff: {
        name: updated.name,
        position: updated.position,
        dailyRate: updated.dailyRate ? Number(updated.dailyRate) : null,
        hourlyRate: updated.hourlyRate ? Number(updated.hourlyRate) : null,
        phone: updated.phone,
        email: updated.email,
      },
    });

    return NextResponse.json({ ok: true, name: updated.name });
  }
);

/**
 * DELETE /api/personnel/[id] — "Remove personnel" (resignation). Deactivates
 * the account and their project assignments; attendance and payroll history
 * are preserved (append-only, Spec §8).
 */
export const DELETE = handleApi(
  async (_req: NextRequest, { params }: { params: { id: string } }) => {
    const user = await requireUser(["OWNER"]); // only the Owner removes accounts

    const target = await prisma.user.findUnique({ where: { id: params.id } });
    if (!target) throw new ApiError(404, "Personnel not found");
    if (target.role === "OWNER") throw new ApiError(400, "The owner account cannot be removed");
    if (target.id === user.id) throw new ApiError(400, "You cannot remove yourself");
    if (!target.active) throw new ApiError(400, "Already removed");

    await prisma.$transaction([
      prisma.user.update({ where: { id: target.id }, data: { active: false } }),
      prisma.projectAssignment.updateMany({
        where: { userId: target.id },
        data: { active: false },
      }),
    ]);

    await audit({
      entityType: "User",
      entityId: target.id,
      actorId: user.id,
      actorName: user.name,
      action: "PERSONNEL_REMOVED",
      diff: { name: target.name, position: target.position ?? null },
    });

    return NextResponse.json({ ok: true });
  }
);
