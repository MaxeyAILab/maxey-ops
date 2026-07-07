import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fmtDateTime, php } from "@/lib/format";
import { Badge, Button, Card, CardHeader, Table, Td, Th } from "@/components/ui";

export const metadata = { title: "Requisitions" };
export const dynamic = "force-dynamic";

export default async function RequisitionsPage() {
  const user = await getSessionUser();
  if (!user || !["OWNER", "PM", "FOREMAN", "PURCHASING", "ACCOUNTING", "DRIVER"].includes(user.role)) {
    redirect("/attendance");
  }

  const where = user.role === "FOREMAN" ? { submittedById: user.id } : {};
  const requisitions = await prisma.requisition.findMany({
    where,
    orderBy: { submittedAt: "desc" },
    include: {
      items: true,
      project: { select: { name: true } },
      submittedBy: { select: { name: true } },
      purchaseOrder: { select: { poNumber: true } },
    },
  });

  const actionable = requisitions.filter((r) =>
    ["SUBMITTED", "UNDER_REVIEW"].includes(r.status)
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink-900">Material Requisitions</h1>
          {user.role === "OWNER" && actionable.length > 0 && (
            <p className="text-sm text-amber-600">
              {actionable.length} awaiting your review/approval
            </p>
          )}
        </div>
        {["FOREMAN", "PM", "OWNER"].includes(user.role) && (
          <Link href="/requisitions/new">
            <Button>+ New requisition</Button>
          </Link>
        )}
      </div>

      <Card>
        <CardHeader
          title="All requisitions"
          subtitle="Submitted → costed → Owner approval → PO — full audit trail on each"
        />
        <Table>
          <thead>
            <tr>
              <Th>Submitted</Th>
              <Th>Project</Th>
              <Th>By</Th>
              <Th>Items</Th>
              <Th>Urgency</Th>
              <Th className="text-right">Est. cost</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {requisitions.map((r) => (
              <tr key={r.id} className="hover:bg-ink-50">
                <Td>
                  <Link
                    href={`/requisitions/${r.id}`}
                    className="font-medium text-brand-600 hover:underline"
                  >
                    {fmtDateTime(r.submittedAt)}
                  </Link>
                  {r.offlineSynced && (
                    <div className="text-[10px] uppercase text-ink-400">synced offline</div>
                  )}
                </Td>
                <Td>{r.project.name}</Td>
                <Td>{r.submittedBy.name}</Td>
                <Td className="max-w-[220px]">
                  <span className="line-clamp-2 text-xs text-ink-500">
                    {r.items.map((i) => `${Number(i.qty)} ${i.unit} ${i.name}`).join(", ")}
                  </span>
                </Td>
                <Td>
                  <Badge value={r.urgency} />
                </Td>
                <Td className="text-right tabular-nums">
                  {r.estimatedCost ? php(r.estimatedCost.toString()) : "—"}
                </Td>
                <Td>
                  <Badge value={r.status} />
                  {r.purchaseOrder && (
                    <div className="text-[10px] text-ink-400">{r.purchaseOrder.poNumber}</div>
                  )}
                </Td>
              </tr>
            ))}
            {requisitions.length === 0 && (
              <tr>
                <Td colSpan={7} className="py-8 text-center text-ink-400">
                  No requisitions yet.
                </Td>
              </tr>
            )}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
