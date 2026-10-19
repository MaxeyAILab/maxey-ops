import { prisma } from "@/lib/prisma";

/**
 * Per-record file access for CLIENT logins (staff are unchanged). A client may open an
 * uploaded file only when it is attached to something the portal already shows them on
 * one of their own projects — so a guessed or forwarded /api/files link to a check photo,
 * receipt or internal site photo is refused. The rules mirror the portal page's queries;
 * keep the two in step when the portal starts showing a new kind of attachment.
 */
export async function clientCanViewFile(clientId: string, fileUrl: string): Promise<boolean> {
  // Non-corporate jobs are internal and never shown to any client.
  const project = { clientId, isNonCorporate: false };
  const has = { array_contains: [fileUrl] };

  const counts = await Promise.all([
    // Reviewed progress the team shared
    prisma.progressEntry.count({ where: { project, visibleToClient: true, reviewStatus: "APPROVED", photos: has } }),
    prisma.dailyConstructionReport.count({ where: { project, visibleToClient: true, photos: has } }),
    // RFIs addressed to the client: the question's photos and their own answer's photos
    prisma.rfi.count({
      where: { project, addressedTo: "CLIENT", status: { not: "CANCELLED" }, OR: [{ photos: has }, { responsePhotos: has }] },
    }),
    // Change orders in states the client sees (never potential/withdrawn)
    prisma.changeOrder.count({ where: { project, status: { in: ["PENDING_CLIENT", "APPROVED", "REJECTED"] }, photos: has } }),
    // Their requests (own, or recorded for them by staff)
    prisma.workRequest.count({ where: { project, photos: has } }),
    // Shared documents, current revision only
    prisma.documentRevision.count({ where: { url: fileUrl, current: true, document: { visibleToClient: true, project } } }),
  ]);
  return counts.some((n) => n > 0);
}
