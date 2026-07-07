import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fmtDate, fmtDateTime, php } from "@/lib/format";
import { Badge, Card, CardHeader, Table, Td, Th } from "@/components/ui";

export const metadata = { title: "Purchasing" };
export const dynamic = "force-dynamic";

export default async function PurchasingPage() {
  const user = await getSessionUser();
  if (!user || !["OWNER", "PURCHASING", "ACCOUNTING", "FOREMAN", "DRIVER"].includes(user.role)) {
    redirect("/attendance");
  }

  const [awaitingPo, pos] = await Promise.all([
    prisma.requisition.findMany({
      where: { status: "APPROVED", purchaseOrder: null },
      orderBy: { approvedAt: "asc" },
      include: {
        items: true,
        project: { select: { name: true } },
        submittedBy: { select: { name: true } },
      },
    }),
    prisma.purchaseOrder.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        requisition: { include: { project: { select: { name: true } } } },
      },
    }),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-ink-900">Purchasing</h1>

      <Card>
        <CardHeader
          title={`Approved requisitions awaiting PO (${awaitingPo.length})`}
          subtitle="Auto-forwarded on Owner approval — quantities and costs locked"
        />
        <Table>
          <thead>
            <tr>
              <Th>Approved</Th>
              <Th>Project</Th>
              <Th>Requested by</Th>
              <Th>Items</Th>
              <Th className="text-right">Est. cost</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {awaitingPo.map((r) => (
              <tr key={r.id} className="hover:bg-ink-50">
                <Td className="text-xs">{fmtDateTime(r.approvedAt)}</Td>
                <Td>{r.project.name}</Td>
                <Td>{r.submittedBy.name}</Td>
                <Td className="max-w-[240px]">
                  <span className="line-clamp-2 text-xs text-ink-500">
                    {r.items.map((i) => `${Number(i.qty)} ${i.unit} ${i.name}`).join(", ")}
                  </span>
                </Td>
                <Td className="text-right tabular-nums">
                  {r.estimatedCost ? php(r.estimatedCost.toString()) : "—"}
                </Td>
                <Td>
                  <Link
                    href={`/requisitions/${r.id}`}
                    className="font-medium text-brand-600 hover:underline"
                  >
                    Create PO →
                  </Link>
                </Td>
              </tr>
            ))}
            {awaitingPo.length === 0 && (
              <tr>
                <Td colSpan={6} className="py-8 text-center text-ink-400">
                  Nothing waiting — approved requisitions land here automatically.
                </Td>
              </tr>
            )}
          </tbody>
        </Table>
      </Card>

      <Card>
        <CardHeader title={`Purchase orders (${pos.length})`} />
        <Table>
          <thead>
            <tr>
              <Th>PO #</Th>
              <Th>Project</Th>
              <Th>Supplier</Th>
              <Th className="text-right">Total</Th>
              <Th>Delivery</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {pos.map((po) => (
              <tr key={po.id} className="hover:bg-ink-50">
                <Td className="font-medium">{po.poNumber}</Td>
                <Td>{po.requisition.project.name}</Td>
                <Td>{po.supplier}</Td>
                <Td className="text-right tabular-nums">{php(po.totalCost.toString())}</Td>
                <Td>{fmtDate(po.deliveryDate)}</Td>
                <Td>
                  <Badge value={po.status} />
                </Td>
              </tr>
            ))}
            {pos.length === 0 && (
              <tr>
                <Td colSpan={6} className="py-8 text-center text-ink-400">
                  No purchase orders yet.
                </Td>
              </tr>
            )}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
