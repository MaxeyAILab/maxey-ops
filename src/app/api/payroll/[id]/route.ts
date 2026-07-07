import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";

const patchSchema = z.object({
  status: z.enum(["REVIEW", "APPROVED", "PAID"]),
});

/**
 * PATCH /api/payroll/[id] — move a run through DRAFT → REVIEW → APPROVED →
 * PAID. Approval is Owner-only; runs are never edited, only regenerated
 * (delete-and-recreate happens as a new DRAFT, keeping the audit trail).
 */
export const PATCH = handleApi(
  async (req: NextRequest, { params }: { params: { id: string } }) => {
    const body = patchSchema.parse(await req.json());
    const user =
      body.status === "APPROVED"
        ? await requireUser(["OWNER"])
        : await requireUser(["OWNER", "ACCOUNTING"]);

    const run = await prisma.payrollRun.findUnique({ where: { id: params.id } });
    if (!run) throw new ApiError(404, "Payroll run not found");

    const order = ["DRAFT", "REVIEW", "APPROVED", "PAID"];
    if (order.indexOf(body.status) <= order.indexOf(run.status)) {
      throw new ApiError(400, `Run is already ${run.status}`);
    }
    if (body.status === "PAID" && run.status !== "APPROVED") {
      throw new ApiError(400, "Run must be approved before marking paid");
    }

    const updated = await prisma.payrollRun.update({
      where: { id: params.id },
      data: { status: body.status },
    });

    await audit({
      entityType: "PayrollRun",
      entityId: run.id,
      actorId: user.id,
      actorName: user.name,
      action: `PAYROLL_${body.status}`,
      diff: { from: run.status, to: body.status },
    });

    return NextResponse.json(updated);
  }
);
