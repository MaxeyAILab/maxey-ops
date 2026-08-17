import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
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

const deleteSchema = z.object({ force: z.boolean().optional() });

/**
 * DELETE /api/projects/[id] — Owner only.
 *
 * Plain delete: succeeds instantly if the project has nothing attached.
 * If it does, refuses and returns a count breakdown instead of the raw FK
 * error — the client shows that breakdown and, if the Owner explicitly
 * confirms, replays the request with { force: true }, which cascades
 * through everything the project actually owns (requisitions → POs →
 * deliveries, payments, attendance, payroll, progress, instructions, etc.)
 * inside one transaction. Equipment/inventory ledger rows that merely
 * reference this project (tool checkouts, material movements) are unlinked
 * rather than deleted — that history belongs to the tool/warehouse item, not
 * the project. AuditLog rows are never touched (Spec §8 append-only); a
 * PROJECT_FORCE_DELETED entry records exactly what was removed.
 */
export const DELETE = handleApi(
  async (req: NextRequest, { params }: { params: { id: string } }) => {
    const user = await requireUser(["OWNER"]);
    const body = deleteSchema.parse(await req.json().catch(() => ({})));

    const project = await prisma.project.findUnique({ where: { id: params.id } });
    if (!project) throw new ApiError(404, "Project not found");

    const requisitionIds = (
      await prisma.requisition.findMany({ where: { projectId: project.id }, select: { id: true } })
    ).map((r) => r.id);
    const poIds = requisitionIds.length
      ? (
          await prisma.purchaseOrder.findMany({
            where: { requisitionId: { in: requisitionIds } },
            select: { id: true },
          })
        ).map((po) => po.id)
      : [];

    const [
      deliveries,
      payments,
      changeOrders,
      progressEntries,
      instructions,
      meetings,
      logbookEntries,
      tripLogs,
      attendance,
      assignments,
      payrollRuns,
      materialStocks,
    ] = await Promise.all([
      prisma.delivery.count({ where: { OR: [{ projectId: project.id }, { poId: { in: poIds } }] } }),
      prisma.payment.count({ where: { projectId: project.id } }),
      prisma.changeOrder.count({ where: { projectId: project.id } }),
      prisma.progressEntry.count({ where: { projectId: project.id } }),
      prisma.siteInstruction.count({ where: { projectId: project.id } }),
      prisma.meeting.count({ where: { projectId: project.id } }),
      prisma.logbookEntry.count({ where: { projectId: project.id } }),
      prisma.tripLog.count({ where: { projectId: project.id } }),
      prisma.attendance.count({ where: { projectId: project.id } }),
      prisma.projectAssignment.count({ where: { projectId: project.id } }),
      prisma.payrollRun.count({ where: { projectId: project.id } }),
      prisma.projectMaterialStock.count({ where: { projectId: project.id } }),
    ]);

    const counts = {
      requisitions: requisitionIds.length,
      purchaseOrders: poIds.length,
      deliveries,
      payments,
      changeOrders,
      progressEntries,
      instructions,
      meetings,
      logbookEntries,
      tripLogs,
      attendance,
      assignments,
      payrollRuns,
      materialStocks,
    };
    const totalRelated = Object.values(counts).reduce((a, b) => a + b, 0);

    if (totalRelated > 0 && !body.force) {
      return NextResponse.json(
        {
          error: "This project has related records and can't be deleted without confirming.",
          blocked: true,
          counts,
        },
        { status: 400 }
      );
    }

    if (totalRelated > 0) {
      await prisma.$transaction([
        prisma.delivery.deleteMany({ where: { OR: [{ projectId: project.id }, { poId: { in: poIds } }] } }),
        prisma.purchaseOrder.deleteMany({ where: { id: { in: poIds } } }),
        prisma.requisition.deleteMany({ where: { projectId: project.id } }), // cascades RequisitionItem
        prisma.payment.deleteMany({ where: { projectId: project.id } }),
        prisma.changeOrder.deleteMany({ where: { projectId: project.id } }),
        prisma.progressEntry.deleteMany({ where: { projectId: project.id } }),
        prisma.siteInstruction.deleteMany({ where: { projectId: project.id } }),
        prisma.meeting.deleteMany({ where: { projectId: project.id } }),
        prisma.logbookEntry.deleteMany({ where: { projectId: project.id } }),
        prisma.tripLog.deleteMany({ where: { projectId: project.id } }),
        prisma.attendance.deleteMany({ where: { projectId: project.id } }),
        prisma.projectAssignment.deleteMany({ where: { projectId: project.id } }),
        prisma.payrollRun.deleteMany({ where: { projectId: project.id } }),
        prisma.projectMaterialStock.deleteMany({ where: { projectId: project.id } }),
        // Equipment/inventory ledger history outlives the project — unlink, don't delete.
        prisma.toolAsset.updateMany({ where: { currentProjectId: project.id }, data: { currentProjectId: null } }),
        prisma.toolMovement.updateMany({ where: { fromProjectId: project.id }, data: { fromProjectId: null } }),
        prisma.toolMovement.updateMany({ where: { toProjectId: project.id }, data: { toProjectId: null } }),
        prisma.inventoryMovement.updateMany({ where: { fromProjectId: project.id }, data: { fromProjectId: null } }),
        prisma.inventoryMovement.updateMany({ where: { toProjectId: project.id }, data: { toProjectId: null } }),
        prisma.project.delete({ where: { id: project.id } }),
      ]);
    } else {
      await prisma.project.delete({ where: { id: project.id } });
    }

    await audit({
      entityType: "Project",
      entityId: project.id,
      actorId: user.id,
      actorName: user.name,
      action: totalRelated > 0 ? "PROJECT_FORCE_DELETED" : "PROJECT_DELETED",
      diff: { name: project.name, status: project.status, ...(totalRelated > 0 ? { counts } : {}) },
    });

    return NextResponse.json({ ok: true });
  }
);
