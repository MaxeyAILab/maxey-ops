import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { PAYROLL_CONFIG, normalizeEntries, type PayrollEntry } from "@/lib/payroll";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";

const entryEditSchema = z.object({
  userId: z.string().min(1),
  regularHours: z.coerce.number().min(0),
  otHours: z.coerce.number().min(0),
  hourlyRate: z.coerce.number().min(0),
  sss: z.coerce.number().min(0),
  philhealth: z.coerce.number().min(0),
  pagibig: z.coerce.number().min(0),
  meals: z.coerce.number().min(0),
  cashAdvance: z.coerce.number().min(0),
});

const patchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("set_status"), status: z.enum(["REVIEW", "APPROVED", "PAID"]) }),
  z.object({ action: z.literal("cancel_approval") }),
  z.object({ action: z.literal("update_entries"), entries: z.array(entryEditSchema).min(1) }),
]);

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * PATCH /api/payroll/[id] — either advance the run's status (DRAFT → REVIEW
 * → APPROVED → PAID), or edit the entries themselves. Editing is Owner/PM,
 * and only while the run is still DRAFT or REVIEW — once APPROVED it's the
 * committed labor-cost figure other reports read. The Owner can cancel an
 * approval (back to DRAFT, never once PAID) to correct a mistaken approval.
 * Only the inputs (hours, rate, each deduction) are ever submitted — gross
 * and net are always recomputed server-side from them, so the two can never
 * drift out of sync with what's actually stored.
 */
export const PATCH = handleApi(
  async (req: NextRequest, { params }: { params: { id: string } }) => {
    const body = patchSchema.parse(await req.json());

    if (body.action === "update_entries") {
      const user = await requireUser(["OWNER", "PM"]);
      const run = await prisma.payrollRun.findUnique({ where: { id: params.id } });
      if (!run) throw new ApiError(404, "Payroll run not found");
      if (!["DRAFT", "REVIEW"].includes(run.status)) {
        throw new ApiError(400, `Cannot edit a run that's already ${run.status}`);
      }

      const existing = normalizeEntries(run.entries as unknown as PayrollEntry[]);
      const byUser = new Map(existing.map((e) => [e.userId, e]));
      const updatedEntries: PayrollEntry[] = body.entries.map((edit) => {
        const prior = byUser.get(edit.userId);
        if (!prior) throw new ApiError(400, `Unknown worker on this run: ${edit.userId}`);
        const gross = edit.regularHours * edit.hourlyRate + edit.otHours * edit.hourlyRate * PAYROLL_CONFIG.otMultiplier;
        const net = Math.max(0, gross - edit.sss - edit.philhealth - edit.pagibig - edit.meals - edit.cashAdvance);
        return {
          userId: edit.userId,
          name: prior.name,
          daysWorked: prior.daysWorked,
          regularHours: r2(edit.regularHours),
          otHours: r2(edit.otHours),
          hourlyRate: r2(edit.hourlyRate),
          gross: r2(gross),
          sss: r2(edit.sss),
          philhealth: r2(edit.philhealth),
          pagibig: r2(edit.pagibig),
          meals: r2(edit.meals),
          cashAdvance: r2(edit.cashAdvance),
          net: r2(net),
        };
      });
      // Keep any existing entry not present in the submitted edit list —
      // the UI always sends the full table, but this guards against a
      // partial/stale client payload silently dropping a worker.
      for (const e of existing) {
        if (!updatedEntries.some((u) => u.userId === e.userId)) updatedEntries.push(e);
      }

      const updated = await prisma.payrollRun.update({
        where: { id: params.id },
        data: { entries: updatedEntries as never },
      });

      await audit({
        entityType: "PayrollRun",
        entityId: run.id,
        actorId: user.id,
        actorName: user.name,
        action: "PAYROLL_ENTRIES_EDITED",
        diff: { workers: updatedEntries.length, totalNet: updatedEntries.reduce((s, e) => s + e.net, 0) },
      });

      return NextResponse.json(updated);
    }

    if (body.action === "cancel_approval") {
      const user = await requireUser(["OWNER"]);
      const run = await prisma.payrollRun.findUnique({ where: { id: params.id } });
      if (!run) throw new ApiError(404, "Payroll run not found");
      if (run.status !== "APPROVED") {
        throw new ApiError(400, run.status === "PAID" ? "A run that's already paid can't be reopened" : `Run is ${run.status}, not approved`);
      }
      const updated = await prisma.payrollRun.update({ where: { id: params.id }, data: { status: "DRAFT" } });
      await audit({
        entityType: "PayrollRun",
        entityId: run.id,
        actorId: user.id,
        actorName: user.name,
        action: "PAYROLL_APPROVAL_CANCELLED",
        diff: { from: "APPROVED", to: "DRAFT" },
      });
      return NextResponse.json(updated);
    }

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
