import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fmtDate, fmtDateTime, php } from "@/lib/format";
import { Badge, Card, CardBody, CardHeader, Table, Td, Th } from "@/components/ui";
import { projectOrCategoryLabel } from "@/lib/requisitions";

export const metadata = { title: "Deliveries" };
export const dynamic = "force-dynamic";

const MONTH_FMT = new Intl.DateTimeFormat("en-PH", {
  month: "long",
  year: "numeric",
  timeZone: "Asia/Manila",
});

interface PoItemJson {
  name: string;
  unitCost: number;
}

interface ChecklistItemJson {
  item: string;
  receivedQty: number;
}

/** Value actually received in this delivery — received qty × the PO's canvassed unit cost per item. */
function deliveredCost(poItems: unknown, checklist: unknown): number {
  const items = (poItems as PoItemJson[]) ?? [];
  const costByName = new Map(items.map((i) => [i.name, Number(i.unitCost)]));
  const rows = (checklist as ChecklistItemJson[]) ?? [];
  return rows.reduce((sum, c) => sum + (costByName.get(c.item) ?? 0) * Number(c.receivedQty), 0);
}

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
      include: {
        po: {
          select: {
            poNumber: true,
            supplier: true,
            items: true,
            requisition: { select: { category: true } },
          },
        },
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

  const pendingTotal = pendingPos.reduce((s, po) => s + Number(po.totalCost), 0);
  const recentDeliveries = deliveries.slice(0, 20);

  // Archive every verified delivery into monthly folders, each showing how
  // much material value was received that month.
  type DeliveryRow = (typeof deliveries)[number];
  interface Folder {
    key: string;
    label: string;
    count: number;
    total: number;
    items: { d: DeliveryRow; cost: number }[];
  }
  const folderMap = new Map<string, Folder>();
  let deliveredTotal = 0;
  for (const d of deliveries) {
    const cost = deliveredCost(d.po.items, d.checklist);
    deliveredTotal += cost;
    const at = d.verifiedAt ?? d.createdAt;
    const key = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}`;
    let folder = folderMap.get(key);
    if (!folder) {
      folder = { key, label: MONTH_FMT.format(at), count: 0, total: 0, items: [] };
      folderMap.set(key, folder);
    }
    folder.count += 1;
    folder.total += cost;
    folder.items.push({ d, cost });
  }
  const folders = Array.from(folderMap.values()).sort((a, b) => (a.key < b.key ? 1 : -1));

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
          action={
            pendingPos.length > 0 ? (
              <span className="text-sm font-semibold text-amber-700">
                {php(pendingTotal)} committed
              </span>
            ) : undefined
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
                <Td>
                  {po.requisition.project ? (
                    po.requisition.project.name
                  ) : (
                    <span className="text-amber-600">{projectOrCategoryLabel(po.requisition)}</span>
                  )}
                </Td>
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
        <CardHeader
          title="Delivery forms"
          subtitle="Auto-generated from on-site verification — most recent"
        />
        <CardBody className="space-y-2">
          {recentDeliveries.map((d) => (
            <div key={d.id} className="rounded-lg border border-ink-100 p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <span className="font-medium text-ink-900">{d.po.poNumber}</span>
                  <span className="text-ink-500">
                    {" "}
                    · {d.project?.name ?? projectOrCategoryLabel({ project: null, category: d.po.requisition?.category })}
                  </span>
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

      {folders.length > 0 && (
        <Card>
          <CardHeader
            title="Completed deliveries — by month"
            subtitle="Every verified delivery archived by month, with material value received"
            action={
              <span className="text-sm font-semibold text-emerald-700">
                {php(deliveredTotal)} delivered to date
              </span>
            }
          />
          <div className="divide-y divide-ink-100">
            {folders.map((f) => (
              <details key={f.key} className="group">
                <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-ink-50 sm:px-5">
                  <div className="flex items-center gap-2">
                    <span className="text-ink-400 transition-transform group-open:rotate-90">▶</span>
                    <span className="font-semibold text-ink-900">{f.label}</span>
                  </div>
                  <span className="text-xs font-medium text-emerald-700">
                    {f.count} deliver{f.count === 1 ? "y" : "ies"} · {php(f.total)}
                  </span>
                </summary>
                <div className="border-t border-ink-100 px-4 py-2 sm:px-5">
                  <Table>
                    <thead>
                      <tr>
                        <Th>Date</Th>
                        <Th>PO #</Th>
                        <Th>Project</Th>
                        <Th>Verified by</Th>
                        <Th className="text-right">Value received</Th>
                        <Th>Status</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {f.items.map(({ d, cost }) => (
                        <tr key={d.id} className="hover:bg-ink-50">
                          <Td>{fmtDateTime(d.verifiedAt ?? d.createdAt)}</Td>
                          <Td className="font-medium">{d.po.poNumber}</Td>
                          <Td>
                            {d.project?.name ??
                              projectOrCategoryLabel({ project: null, category: d.po.requisition?.category })}
                          </Td>
                          <Td>{verifierNames.get(d.verifiedById) ?? "—"}</Td>
                          <Td className="text-right tabular-nums">{php(cost)}</Td>
                          <Td>
                            {d.discrepancies ? (
                              <span className="text-xs font-medium text-amber-700">⚠ Discrepancy</span>
                            ) : (
                              <span className="text-xs font-medium text-emerald-600">✓ Complete</span>
                            )}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              </details>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
