import { prisma } from "@/lib/prisma";
import { allowedMenus, canUseCashExpense, canVerifyDelivery } from "@/lib/access";
import { canRaiseRequisition } from "@/lib/requisitions";
import { CHARGEABLE_STATUSES } from "@/lib/project-status";
import type { SessionUser } from "@/lib/auth";
import type { QuickAccess } from "@/lib/quick-actions";

/**
 * What this person may do from the floating + button, and the projects they can post progress on (a foreman: the ones
 * they are assigned to). One place, used by the page layout, My settings and the save check, so they cannot disagree.
 */
export async function quickAccessFor(user: SessionUser): Promise<{ access: QuickAccess; progressProjects: { id: string; name: string }[] }> {
  const menus = allowedMenus(user.role, user.department, user.customMenus, user.useCustomMenus);
  const mayProgress = ["OWNER", "PM", "FOREMAN"].includes(user.role) && menus.includes("/projects");
  const progressProjects = mayProgress
    ? await prisma.project.findMany({
        where: { status: { in: CHARGEABLE_STATUSES }, ...(user.role === "FOREMAN" ? { assignments: { some: { userId: user.id, active: true } } } : {}) },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
        take: 15,
      })
    : [];
  return {
    access: {
      canRaiseRequisition: canRaiseRequisition(user),
      canProgress: mayProgress && progressProjects.length > 0,
      canUseCash: canUseCashExpense(user),
      menus,
      canVerifyDelivery: canVerifyDelivery(user.role, user.department),
    },
    progressProjects,
  };
}
