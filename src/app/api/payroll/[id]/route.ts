import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { hourlyRateForUser, normalizeEntries, otMultiplierFor, pricedEntry, type PayrollEntry } from "@/lib/payroll";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import { ensureSlipRefs } from "@/lib/payslip-refs";

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
  z.object({
    action: z.literal("add_person"),
    userId: z.string().min(1),
    regularHours: z.coerce.number().min(0).max(500),
    otHours: z.coerce.number().min(0).max(500).default(0),
    hourlyRate: z.coerce.number().min(0).max(100000).optional(),
  }),
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
        const gross = edit.regularHours * edit.hourlyRate + edit.otHours * edit.hourlyRate * otMultiplierFor(run.department);
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
          // A reference number, once issued, stays with the person on this run.
          ...(prior.slipRef ? { slipRef: prior.slipRef } : {}),
          ...(prior.manual ? { manual: true } : {}),
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

    if (body.action === "add_person") {
      const user = await requireUser(["OWNER", "PM"]);
      const result = await prisma.$transaction(async (db) => {
        // Lock the run so two edits at once can't overwrite each other's version of the entries.
        await db.$queryRaw`SELECT id FROM "PayrollRun" WHERE id = ${params.id} FOR UPDATE`;
        const run = await db.payrollRun.findUnique({ where: { id: params.id }, include: { project: { select: { name: true } } } });
        if (!run) throw new ApiError(404, "Payroll run not found");
        if (!["DRAFT", "REVIEW"].includes(run.status)) {
          throw new ApiError(400, `Cannot add anyone to a run that's ${run.status} — the Owner can cancel the approval first, then add them`);
        }
        const existing = normalizeEntries(run.entries as unknown as PayrollEntry[]);
        if (existing.some((e) => e.userId === body.userId)) throw new ApiError(400, "That person is already on this run");

        const person = await db.user.findFirst({ where: { id: body.userId, active: true, role: { not: "CLIENT" } } });
        if (!person) throw new ApiError(400, "That person isn't an active staff member");

        let rate = body.hourlyRate;
        if (run.projectId) {
          const assignment = await db.projectAssignment.findFirst({ where: { projectId: run.projectId, userId: person.id, active: true } });
          if (!assignment) throw new ApiError(400, "That person isn't on this project's roster");
          rate ??= Number(assignment.hourlyRate);
        } else {
          if (person.department !== run.department) throw new ApiError(400, `That person isn't in the ${run.department} department`);
          rate ??= hourlyRateForUser(person, run.periodStart);
        }
        if (!(rate > 0)) throw new ApiError(400, "No pay rate is set for this person — enter a rate here, or set one in Personnel");

        // Priced on the rate as the register shows it (to the centavo), so saving the register later can't move the gross.
        const shownRate = Math.round(rate * 100) / 100;
        const entry: PayrollEntry = { ...pricedEntry({ id: person.id, name: person.name }, 0, body.regularHours, body.otHours, shownRate, otMultiplierFor(run.department)), manual: true };
        const entries = [...existing, entry].sort((a, b) => a.name.localeCompare(b.name));
        await db.payrollRun.update({ where: { id: run.id }, data: { entries: entries as never } });
        return { run, entry, workers: entries.length };
      });

      await audit({
        entityType: "PayrollRun",
        entityId: result.run.id,
        actorId: user.id,
        actorName: user.name,
        action: "PAYROLL_PERSON_ADDED",
        diff: { person: result.entry.name, regularHours: result.entry.regularHours, otHours: result.entry.otHours, hourlyRate: result.entry.hourlyRate, gross: result.entry.gross, workers: result.workers },
      });
      return NextResponse.json({ ok: true, entry: result.entry });
    }

    if (body.action === "cancel_approval") {
      const user = await requireUser(["OWNER"]);
      const run = await prisma.payrollRun.findUnique({ where: { id: params.id } });
      if (!run) throw new ApiError(404, "Payroll run not found");
      if (run.status !== "APPROVED") {
        throw new ApiError(400, run.status === "PAID" ? "A run that's already paid can't be reopened" : `Run is ${run.status}, not approved`);
      }
      // Back to draft: the approval details are cleared (they're set again at the next approval); any payslip reference
      // numbers already issued are kept, so a reprint after re-approval carries the same number.
      const updated = await prisma.payrollRun.update({ where: { id: params.id }, data: { status: "DRAFT", approvedAt: null, approvedByName: null } });
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
      data: {
        status: body.status,
        // Stamp who approved it and when — printed on the payslips as "Approved By".
        ...(body.status === "APPROVED" ? { approvedAt: new Date(), approvedByName: user.name } : {}),
      },
    });
    // Payslips get their reference numbers the moment the payroll is approved.
    if (body.status === "APPROVED") await ensureSlipRefs(updated.id);

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

/**
 * DELETE /api/payroll/[id] — Owner removes a generated run (a wrong period, a
 * test run, a run to regenerate from scratch). Paid runs are the record of
 * money actually handed out, so they can't be deleted; the audit entry keeps
 * a record of what was removed.
 */
export const DELETE = handleApi(async (_req: NextRequest, { params }: { params: { id: string } }) => {
  const user = await requireUser(["OWNER"]);
  const run = await prisma.payrollRun.findUnique({
    where: { id: params.id },
    include: { project: { select: { name: true } } },
  });
  if (!run) throw new ApiError(404, "Payroll run not found");
  if (run.status === "PAID") throw new ApiError(400, "A run that's already paid can't be deleted");

  const entries = normalizeEntries(run.entries as unknown as PayrollEntry[]);
  await prisma.payrollRun.delete({ where: { id: run.id } });

  await audit({
    entityType: "PayrollRun",
    entityId: run.id,
    actorId: user.id,
    actorName: user.name,
    action: "PAYROLL_DELETED",
    diff: {
      scope: run.project?.name ?? run.department,
      periodStart: run.periodStart,
      periodEnd: run.periodEnd,
      status: run.status,
      workers: entries.length,
      totalNet: entries.reduce((sum, e) => sum + e.net, 0),
    },
  });

  return NextResponse.json({ ok: true });
});
