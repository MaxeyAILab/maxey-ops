import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { Badge, Card, CardBody, CardHeader, Table, Td, Th } from "@/components/ui";

export const metadata = { title: "Deliveries" };
export const dynamic = "force-dynamic";

export default async function DeliveriesPage() {
  const user = await getSessionUser();
  if (!user || !["FOREMAN", "PM", "OWNER", "PURCHASING", "ACCOUNTING", "DRIVER"].includes(user.role)) {
    redirect("/attendance");
  }

  const [pendingPos, deliveries] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where: { status: { in: ["OPEN", "PARTIALLY_DELIVERED"] } },
      orderBy: { deliveryDate: "asc" },
      include: { requisition: { include: { project: { select: { name: true } } } } },
    }),
    prisma.delivery.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      include: {
        po: { select: { poNumber: true, supplier: true } },
        project: { select: { name: true } },
      },
    }),
  ]);

  const canVerify = ["FOREMAN", "PM", "OWNER"].includes(user.role);
  const verifierNames = new Map(
    (
      await prisma.user.findMany({
        where: { id: { in: deliveries.map((d) => d.verifiedById) } },
        select: { id: true, name: true },
      })
    ).map((u) => [u.id, u.name])
  );

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-ink-900">Deliveries</h1>

      <Card>
        <CardHeader
          title={`Awaiting delivery (${pendingPos.length})`}
          subtitle={
            canVerify
              ? "When materials arrive, open the PO and check items off against the truck"
              : "POs not yet fully delivered"
          }
        />
        <Table>
          <thead>
            <tr>
              <Th>PO #</Th>
              <Th>Project</Th>
              <Th>Supplier</Th>
              <Th>Expected</Th>
              <Th>Status</Th>
              {canVerify && <Th />}
            </tr>
          </thead>
          <tbody>
            {pendingPos.map((po) => (
              <tr key={po.id} className="hover:bg-ink-50">
                <Td className="font-medium">{po.poNumber}</Td>
                <Td>{po.requisition.project.name}</Td>
                <Td>{po.supplier}</Td>
                <Td>{fmtDate(po.deliveryDate)}</Td>
                <Td>
                  <Badge value={po.status} />
                </Td>
                {canVerify && (
                  <Td>
                    <Link
                      href={`/deliveries/${po.id}`}
                      className="font-medium text-brand-600 hover:underline"
                    >
                      Verify delivery →
                    </Link>
                  </Td>
                )}
              </tr>
            ))}
            {pendingPos.length === 0 && (
              <tr>
                <Td colSpan={canVerify ? 6 : 5} className="py-8 text-center text-ink-400">
                  Nothing awaiting delivery.
                </Td>
              </tr>
            )}
          </tbody>
        </Table>
      </Card>

      <Card>
        <CardHeader title="Delivery forms" subtitle="Auto-generated from on-site verification" />
        <CardBody className="space-y-2">
          {deliveries.map((d) => (
            <div key={d.id} className="rounded-lg border border-ink-100 p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <span className="font-medium text-ink-900">{d.po.poNumber}</span>
                  <span className="text-ink-500"> · {d.project.name}</span>
                </div>
                <span className="text-xs text-ink-400">
                  {fmtDateTime(d.verifiedAt ?? d.createdAt)} · by{" "}
                  {verifierNames.get(d.verifiedById) ?? "—"}
                </span>
              </div>
              {d.discrepancies ? (
                <p className="mt-1 whitespace-pre-wrap rounded bg-amber-50 p-2 text-xs text-amber-700">
                  ⚠ {d.discrepancies}
                </p>
              ) : (
                <p className="mt-1 text-xs text-emerald-600">✓ Complete — no discrepancies</p>
              )}
            </div>
          ))}
          {deliveries.length === 0 && (
            <p className="py-4 text-center text-sm text-ink-400">No delivery forms yet.</p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
