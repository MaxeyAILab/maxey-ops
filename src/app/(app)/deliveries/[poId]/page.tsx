import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fmtDate } from "@/lib/format";
import { Badge } from "@/components/ui";
import { DeliveryChecklistForm } from "@/components/delivery-form";

export const dynamic = "force-dynamic";

export default async function VerifyDeliveryPage({ params }: { params: { poId: string } }) {
  const user = await getSessionUser();
  if (!user || !["FOREMAN", "PM", "OWNER"].includes(user.role)) redirect("/deliveries");

  const po = await prisma.purchaseOrder.findUnique({
    where: { id: params.poId },
    include: { requisition: { include: { project: { select: { name: true } } } } },
  });
  if (!po) notFound();

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
            {po.poNumber} — {po.requisition.project.name}
          </h1>
          <Badge value={po.status} />
        </div>
        <p className="text-xs text-ink-500">
          Supplier: {po.supplier} · expected {fmtDate(po.deliveryDate)}
        </p>
      </div>
      <DeliveryChecklistForm poId={po.id} items={items} />
    </div>
  );
}
