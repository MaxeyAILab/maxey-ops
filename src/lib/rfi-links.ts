import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/rbac";

/**
 * Every record an RFI links to must belong to the same project as the RFI —
 * otherwise a user with access to one project could attach (and thereby
 * read the title of) a record from another by guessing its id.
 */
export async function assertLinksBelongToProject(
  projectId: string,
  links: { milestoneId?: string | null; siteInstructionId?: string | null; changeOrderId?: string | null; documentId?: string | null }
) {
  if (links.milestoneId) {
    const m = await prisma.milestone.findUnique({ where: { id: links.milestoneId }, select: { projectId: true } });
    if (!m || m.projectId !== projectId) throw new ApiError(400, "That milestone isn't part of this project");
  }
  if (links.siteInstructionId) {
    const i = await prisma.siteInstruction.findUnique({ where: { id: links.siteInstructionId }, select: { projectId: true } });
    if (!i || i.projectId !== projectId) throw new ApiError(400, "That site instruction isn't part of this project");
  }
  if (links.documentId) {
    const d = await prisma.projectDocument.findUnique({ where: { id: links.documentId }, select: { projectId: true } });
    if (!d || d.projectId !== projectId) throw new ApiError(400, "That document isn't part of this project");
  }
  if (links.changeOrderId) {
    const c = await prisma.changeOrder.findUnique({ where: { id: links.changeOrderId }, select: { projectId: true } });
    if (!c || c.projectId !== projectId) throw new ApiError(400, "That change order isn't part of this project");
  }
}

export async function assertActiveStaff(userId: string, what: string) {
  const u = await prisma.user.findFirst({ where: { id: userId, active: true, role: { not: "CLIENT" } }, select: { id: true } });
  if (!u) throw new ApiError(400, `${what} must be an active staff member`);
}
