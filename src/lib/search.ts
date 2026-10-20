import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { allowedMenus } from "@/lib/access";
import { projectOrCategoryLabel } from "@/lib/requisitions";
import type { SessionUser } from "@/lib/auth";

export interface SearchItem {
  id: string;
  title: string;
  subtitle: string;
  href: string;
}
export interface SearchGroup {
  key: "projects" | "requisitions" | "purchaseOrders" | "people";
  items: SearchItem[];
}

const PER_GROUP = 5;
const label = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

/** Clean what was typed: trim, collapse spaces, at most 60 characters. */
export function cleanQuery(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, 60);
}

/**
 * One search across projects, requisitions, purchase orders and people. Each kind is searched only when the person has that
 * tab, with the same limits the tab itself applies (a foreman sees only the requisitions they submitted; People is Owner-only).
 */
export async function searchEverything(user: SessionUser, q: string): Promise<SearchGroup[]> {
  const term = cleanQuery(q);
  if (term.length < 2) return [];
  const menus = new Set(allowedMenus(user.role, user.department, user.customMenus, user.useCustomMenus));
  const has = { contains: term, mode: "insensitive" as const };
  const groups: SearchGroup[] = [];

  const [projects, requisitions, orders, people] = await Promise.all([
    menus.has("/projects")
      ? prisma.project.findMany({
          where: { OR: [{ name: has }, { code: has }, { address: has }, { client: { name: has } }] },
          select: { id: true, name: true, status: true, client: { select: { name: true } } },
          orderBy: { name: "asc" },
          take: PER_GROUP,
        })
      : [],
    menus.has("/requisitions")
      ? prisma.requisition.findMany({
          where: {
            AND: [
              user.role === "FOREMAN" ? { submittedById: user.id } : {},
              { OR: [{ items: { some: { name: has } } }, { notes: has }, { project: { name: has } }, { submittedBy: { name: has } }] },
            ],
          } satisfies Prisma.RequisitionWhereInput,
          select: { id: true, status: true, category: true, project: { select: { name: true } }, submittedBy: { select: { name: true } }, items: { select: { name: true }, take: 2 }, _count: { select: { items: true } } },
          orderBy: { submittedAt: "desc" },
          take: PER_GROUP,
        })
      : [],
    menus.has("/purchasing")
      ? prisma.purchaseOrder.findMany({
          where: { OR: [{ poNumber: has }, { supplier: has }, { requisition: { project: { name: has } } }] },
          select: { id: true, poNumber: true, supplier: true, status: true, requisition: { select: { category: true, project: { select: { name: true } } } } },
          orderBy: { createdAt: "desc" },
          take: PER_GROUP,
        })
      : [],
    user.role === "OWNER"
      ? prisma.user.findMany({
          where: { role: { not: "CLIENT" }, OR: [{ name: has }, { email: has }, { position: has }, { employeeNo: has }] },
          select: { id: true, name: true, position: true, role: true, employeeNo: true, active: true },
          orderBy: { name: "asc" },
          take: PER_GROUP,
        })
      : [],
  ]);

  if (projects.length) {
    groups.push({
      key: "projects",
      items: projects.map((p) => ({ id: p.id, title: p.name, subtitle: `${p.client.name} · ${label(p.status)}`, href: `/projects/${p.id}` })),
    });
  }
  if (requisitions.length) {
    groups.push({
      key: "requisitions",
      items: requisitions.map((r) => {
        const extra = r._count.items - r.items.length;
        return {
          id: r.id,
          title: r.items.map((i) => i.name).join(", ") + (extra > 0 ? ` +${extra} more` : ""),
          subtitle: `${projectOrCategoryLabel(r)} · ${label(r.status)} · ${r.submittedBy.name}`,
          href: `/requisitions/${r.id}`,
        };
      }),
    });
  }
  if (orders.length) {
    groups.push({
      key: "purchaseOrders",
      items: orders.map((o) => ({ id: o.id, title: `${o.poNumber} · ${o.supplier}`, subtitle: `${projectOrCategoryLabel(o.requisition)} · ${label(o.status)}`, href: `/purchasing/${o.id}` })),
    });
  }
  if (people.length) {
    groups.push({
      key: "people",
      items: people.map((p) => ({ id: p.id, title: p.name, subtitle: [p.position ?? label(p.role), p.employeeNo, p.active ? null : "Inactive"].filter(Boolean).join(" · "), href: "/people" })),
    });
  }
  return groups;
}
