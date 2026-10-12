import { prisma } from "@/lib/prisma";

/** Write one permanent line to a project's activity history. Never throws —
 * a failed log line must not break the action that triggered it. */
export async function logProjectActivity(params: {
  projectId: string;
  type: string;
  refId?: string | null;
  summary: string;
  actorName: string;
  createdAt?: Date;
}) {
  try {
    await prisma.projectActivityLog.create({
      data: {
        projectId: params.projectId,
        type: params.type,
        refId: params.refId ?? null,
        summary: params.summary,
        actorName: params.actorName,
        createdAt: params.createdAt,
      },
    });
  } catch (err) {
    console.error("[project-activity]", err);
  }
}

export interface ActivityItem {
  key: string;
  type: "progress" | "report" | "change" | "payment" | "requisition" | "rfi" | "milestone";
  at: Date;
  title: string;
  detail: string;
  actor: string;
  href: string;
  /** True for a line kept after its live record was removed. */
  archived?: boolean;
}

/**
 * Combine live records with permanent log lines, newest first. A log line is
 * hidden while its live record (same refId) is still showing, so a daily
 * report appears once while it exists and as a one-line archived entry after
 * the 7-day cleanup removes it.
 */
export function mergeActivity(
  live: (ActivityItem & { refId?: string })[],
  logs: { id: string; refId: string | null; type: string; summary: string; actorName: string; createdAt: Date; href: string }[],
  limit: number
): ActivityItem[] {
  const liveRefs = new Set(live.map((l) => l.refId).filter(Boolean));
  const archived: ActivityItem[] = logs
    .filter((l) => !(l.refId && liveRefs.has(l.refId)))
    .map((l) => ({
      key: `log-${l.id}`,
      type: "report" as const,
      at: l.createdAt,
      title: l.summary,
      detail: "Report removed after 7 days — log line kept",
      actor: l.actorName,
      href: l.href,
      archived: true,
    }));
  return [...live, ...archived].sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
}
