import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fmtDate, fmtDateTime, php } from "@/lib/format";
import { Badge, Card, CardHeader, Table, Td, Th } from "@/components/ui";
import { CancelPoButton } from "@/components/requisition-actions";
import { projectOrCategoryLabel } from "@/lib/requisitions";
import { canAccess } from "@/lib/access";

interface PoItemJson {
  name: string;
  qty: number;
  unit: string;
  unitCost: number;
}

export default async function PurchaseOrderDetailPage({ params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user || !canAccess(user.role, user.department, "/purchasing", user.customMenus, user.useCustomMenus)) {
    redirect("/attendance");
  }

  const po = await prisma.purchaseOrder.findUnique({
    where: { id: params.id },
    include: {
      createdBy: { select: { name: true } },
      requisition: {
        include: {
          project: { select: { name: true, address: true } },
          submittedBy: { select: { name: true } },
          approvedBy: { select: { name: true } },
        },
      },
      deliveries: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!po) notFound();

  const items = po.items as unknown as PoItemJson[];
  const label = projectOrCategoryLabel(po.requisition);
  const canCancel =
    user.role === "OWNER" && ["OPEN", "PARTIALLY_DELIVERED"].includes(po.status);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/purchasing" className="text-xs text-ink-400 hover:text-ink-600">
            ← All purchase orders
          </Link>
          <h1 className="text-xl font-bold text-ink-900">
            {po.poNumber} — {label}
          </h1>
          <p className="text-xs text-ink-500">
            Created by {po.createdBy.name} on {fmtDateTime(po.createdAt)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge value={po.status} />
          <a
            href={`/api/purchase-orders/${po.id}/pdf`}
            className="rounded-lg border border-ink-200 px-3 py-1.5 text-sm font-medium text-ink-700 hover:bg-ink-50"
          >
            ⬇ Download
          </a>
          {canCancel && <CancelPoButton poId={po.id} />}
        </div>
      </div>

      <Card>
        <CardHeader
          title="Order details"
          subtitle={`Supplier: ${po.supplier}${po.deliveryDate ? ` · Expected ${fmtDate(po.deliveryDate)}` : ""}`}
        />
        <Table>
          <thead>
            <tr>
              <Th>Item</Th>
              <Th>Qty</Th>
              <Th>Unit</Th>
              <Th className="text-right">Unit cost</Th>
              <Th className="text-right">Line total</Th>
            </tr>
          </thead>
          <tbody>
            {items.map((i, idx) => (
              <tr key={idx}>
                <Td>{i.name}</Td>
                <Td>{i.qty}</Td>
                <Td>{i.unit}</Td>
                <Td className="text-right tabular-nums">{php(i.unitCost)}</Td>
                <Td className="text-right tabular-nums">{php(i.qty * i.unitCost)}</Td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-ink-200 font-semibold">
              <Td colSpan={4} className="text-right">
                Total
              </Td>
              <Td className="text-right tabular-nums">{php(po.totalCost.toString())}</Td>
            </tr>
          </tfoot>
        </Table>
      </Card>

      <Card>
        <CardHeader
          title="Source requisition"
          subtitle={`Submitted by ${po.requisition.submittedBy.name}${
            po.requisition.approvedBy ? ` · approved by ${po.requisition.approvedBy.name}` : ""
          }`}
        />
        <div className="p-4 text-sm sm:p-5">
          <Link
            href={`/requisitions/${po.requisition.id}`}
            className="font-medium text-brand-600 hover:underline"
          >
            View original requisition →
          </Link>
        </div>
      </Card>

      {po.deliveries.length > 0 && (
        <Card>
          <CardHeader title={`Deliveries against this PO (${po.deliveries.length})`} />
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Driver</Th>
                <Th>Received by</Th>
                <Th>Discrepancies</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {po.deliveries.map((d) => (
                <tr key={d.id}>
                  <Td className="text-xs">{fmtDateTime(d.verifiedAt ?? d.createdAt)}</Td>
                  <Td>{d.driverName ?? "—"}</Td>
                  <Td>{d.recipientName ?? "—"}</Td>
                  <Td>
                    {d.discrepancies ? (
                      <span className="text-xs font-medium text-amber-700">⚠ {d.discrepancies}</span>
                    ) : (
                      <span className="text-xs font-medium text-emerald-600">✓ Complete</span>
                    )}
                  </Td>
                  <Td className="text-right">
                    <a
                      href={`/api/deliveries/${d.id}/pdf`}
                      className="text-xs font-medium text-brand-600 hover:underline"
                    >
                      ⬇ Download tally
                    </a>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}
