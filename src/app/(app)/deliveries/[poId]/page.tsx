import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fmtDate } from "@/lib/format";
import { Badge } from "@/components/ui";
import { DeliveryChecklistForm } from "@/components/delivery-form";
import { projectOrCategoryLabel } from "@/lib/requisitions";
import { canVerifyDelivery } from "@/lib/access";

export const dynamic = "force-dynamic";

export default async function VerifyDeliveryPage({ params }: { params: { poId: string } }) {
  const user = await getSessionUser();
  if (!user || !canVerifyDelivery(user.role, user.department)) redirect("/deliveries");

  const po = await prisma.purchaseOrder.findUnique({
    where: { id: params.poId },
    include: { requisition: { include: { project: { select: { name: true } } } } },
  });
  if (!po) notFound();

  // the person receiving the delivery is chosen from the staff; they confirm it afterwards
  const [staff, waiting] = await Promise.all([
    prisma.user.findMany({ where: { active: true, role: { not: "CLIENT" } }, orderBy: { name: "asc" }, select: { id: true, name: true, position: true } }),
    prisma.delivery.findFirst({ where: { poId: po.id, needsConfirmation: true, confirmedAt: null }, select: { recipientName: true } }),
  ]);

  // PO items are stored as JSON; foremen see qty/spec but not unit costs
  const items = (po.items as { name: string; qty: number; unit: string }[]).map((i) => ({
    name: i.name,
    qty: i.qty,
    unit: i.unit,
  }));

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <Link href="/deliveries" className="text-xs text-ink-400 hover:text-ink-600">
          ← Deliveries
        </Link>
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-bold text-ink-900">
            {po.poNumber} — {projectOrCategoryLabel(po.requisition)}
          </h1>
          <Badge value={po.status} />
        </div>
        <p className="text-xs text-ink-500">
          Supplier: {po.supplier} · expected {fmtDate(po.deliveryDate)}
        </p>
      </div>
      {waiting ? (
        <p className="rounded-lg bg-amber-50 p-4 text-sm text-amber-800">
          A delivery for this PO was already verified and is waiting for {waiting.recipientName ?? "the receiver"} to confirm it. It can be verified again once that is done.
        </p>
      ) : (
        <DeliveryChecklistForm poId={po.id} items={items} receivers={staff} meId={user.id} />
      )}
    </div>
  );
}
