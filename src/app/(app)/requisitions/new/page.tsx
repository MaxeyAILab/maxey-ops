import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { RequisitionForm } from "@/components/requisition-form";
import { CHARGEABLE_STATUSES } from "@/lib/project-status";

export const metadata = { title: "New Requisition" };
export const dynamic = "force-dynamic";

export default async function NewRequisitionPage() {
  const user = await getSessionUser();
  if (!user || !["FOREMAN", "PM", "OWNER"].includes(user.role)) redirect("/requisitions");

  const projects = await prisma.project.findMany({
    where: { status: { in: CHARGEABLE_STATUSES } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-xl font-bold text-ink-900">New Material Requisition</h1>
      {projects.length === 0 && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
          No active projects yet — that&apos;s fine, submit this as an emergency/general
          requisition below and it can be linked to a project later.
        </p>
      )}
      <RequisitionForm projects={projects} />
    </div>
  );
}
