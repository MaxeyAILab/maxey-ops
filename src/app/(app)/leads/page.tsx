import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { LeadsView } from "@/components/leads-view";

export const metadata = { title: "Leads" };
export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const user = await getSessionUser();
  if (!user || user.role !== "OWNER") redirect("/attendance"); // Owner-only

  // Oldest first = first-come-first-served queue (Spec 6.1)
  const leads = await prisma.lead.findMany({
    orderBy: { createdAt: "asc" },
    include: { quotations: { select: { id: true } } },
  });

  const boardLeads = leads.map((l) => ({
    id: l.id,
    contactName: l.contactName,
    phone: l.phone,
    email: l.email,
    source: l.source,
    status: l.status,
    createdAt: l.createdAt.toISOString(),
    estimateDueBy: l.estimateDueBy ? l.estimateDueBy.toISOString() : null,
    quotationCount: l.quotations.length,
  }));

  return <LeadsView leads={boardLeads} />;
}
