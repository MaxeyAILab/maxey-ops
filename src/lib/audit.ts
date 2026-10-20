import { prisma } from "@/lib/prisma";
import { dispatchAuditEvent } from "@/lib/notifications";
import type { Prisma } from "@prisma/client";

/**
 * Append-only audit trail — every create/edit/approve action calls this
 * (Spec §8, non-negotiable). Never update or delete AuditLog rows.
 */
export async function audit(params: {
  entityType: string;
  entityId: string;
  actorId?: string | null;
  actorName: string;
  action: string;
  diff?: Prisma.InputJsonValue;
}) {
  await prisma.auditLog.create({
    data: {
      entityType: params.entityType,
      entityId: params.entityId,
      actorId: params.actorId ?? null,
      actorName: params.actorName,
      action: params.action,
      diff: params.diff,
    },
  });
  // Tell the people involved (their bell, and their phone if they turned notifications on). Never throws or blocks for long.
  await dispatchAuditEvent(params);
}
