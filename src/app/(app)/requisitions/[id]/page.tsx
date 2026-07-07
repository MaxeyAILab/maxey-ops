import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fmtDate, fmtDateTime, php } from "@/lib/format";
import { Badge, Card, CardBody, CardHeader, Table, Td, Th } from "@/components/ui";
import {
  ApproveRejectButtons,
  CostRequisitionForm,
  CreatePoForm,
} from "@/components/requisition-actions";

export const dynamic = "force-dynamic";

export default async function RequisitionDetailPage({ params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user || !["OWNER", "PM", "FOREMAN", "PURCHASING", "ACCOUNTING", "DRIVER"].includes(user.role)) {
    redirect("/attendance");
  }

  const r = await prisma.requisition.findUnique({
    where: { id: params.id },
    include: {
      items: true,
      project: { select: { id: true, name: true } },
      submittedBy: { select: { name: true } },
      approvedBy: { select: { name: true } },
      purchaseOrder: true,
    },
  });
  if (!r) notFound();
  // Foremen can only open their own requisitions
  if (user.role === "FOREMAN" && r.submittedBy.name !== user.name) redirect("/requisitions");

  const auditTrail = await prisma.auditLog.findMany({
    where: { entityType: "Requisition", entityId: r.id },
    orderBy: { createdAt: "asc" },
  });

  const canCost =
    ["PM", "OWNER", "ACCOUNTING"].includes(user.role) &&
    ["SUBMITTED", "UNDER_REVIEW"].includes(r.status);
  const canApprove =
    user.role === "OWNER" && ["SUBMITTED", "UNDER_REVIEW"].includes(r.status);
  const canCreatePo =
    ["PURCHASING", "OWNER"].includes(user.role) && r.status === "APPROVED" && !r.purchaseOrder;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/requisitions" className="text-xs text-ink-400 hover:text-ink-600">
            ← All requisitions
          </Link>
          <h1 className="text-xl font-bold text-ink-900">
            Requisition — {r.project.name}
          </h1>
          <p className="text-xs text-ink-500">
            Submitted by {r.submittedBy.name} on {fmtDateTime(r.submittedAt)}
            {r.offlineSynced && " (captured offline, synced later)"}
            {r.neededBy && ` · needed by ${fmtDate(r.neededBy)}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge value={r.urgency} />
          <Badge value={r.status} />
        </div>
      </div>

      <Card>
        <CardHeader title="Requested items" />
        <Table>
          <thead>
            <tr>
              <Th>Item</Th>
              <Th>Specification</Th>
              <Th className="text-right">Qty</Th>
              <Th>Unit</Th>
            </tr>
          </thead>
          <tbody>
            {r.items.map((i) => (
              <tr key={i.id}>
                <Td className="font-medium">{i.name}</Td>
                <Td className="text-ink-500">{i.spec ?? "—"}</Td>
                <Td className="text-right tabular-nums">{Number(i.qty)}</Td>
                <Td>{i.unit}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {r.notes && (
          <CardBody className="border-t border-ink-100 text-sm text-ink-600">
            <span className="font-medium">Notes:</span> {r.notes}
          </CardBody>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Workflow"
            subtitle={
              r.estimatedCost
                ? `Estimated cost: ${php(r.estimatedCost.toString())}`
                : "Not yet costed"
            }
          />
          <CardBody className="space-y-4">
            {r.status === "REJECTED" && (
              <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
                Rejected: {r.rejectedReason}
              </p>
            )}
            {r.approvedBy && r.approvedAt && (
              <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">
                Approved by {r.approvedBy.name} on {fmtDateTime(r.approvedAt)} — cost committed
                to project budget.
              </p>
            )}
            {canCost && <CostRequisitionForm requisitionId={r.id} />}
            {canApprove && (
              <div>
                <p className="mb-2 text-xs text-ink-500">
                  Owner approval {r.estimatedCost ? "" : "(consider costing first)"}
                </p>
                <ApproveRejectButtons requisitionId={r.id} />
              </div>
            )}
            {r.purchaseOrder && (
              <div className="rounded-lg border border-ink-100 p-3 text-sm">
                <div className="font-semibold text-ink-900">{r.purchaseOrder.poNumber}</div>
                <div className="text-ink-600">
                  Supplier: {r.purchaseOrder.supplier} · Total:{" "}
                  {php(r.purchaseOrder.totalCost.toString())}
                  {r.purchaseOrder.deliveryDate &&
                    ` · Delivery ${fmtDate(r.purchaseOrder.deliveryDate)}`}
                </div>
              </div>
            )}
            {canCreatePo && (
              <div>
                <p className="mb-2 text-sm font-semibold text-ink-900">
                  Convert to Purchase Order
                </p>
                <CreatePoForm
                  requisitionId={r.id}
                  initialItems={r.items.map((i) => ({
                    name: i.name,
                    qty: Number(i.qty),
                    unit: i.unit,
                  }))}
                />
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Audit trail" subtitle="Append-only — every action, attributed" />
          <CardBody>
            <ol className="space-y-2 text-sm">
              {auditTrail.map((a) => (
                <li key={a.id} className="flex gap-3">
                  <span className="whitespace-nowrap text-xs tabular-nums text-ink-400">
                    {fmtDateTime(a.createdAt)}
                  </span>
                  <span className="text-ink-700">
                    <span className="font-medium">{a.actorName}</span> —{" "}
                    {a.action.replace(/_/g, " ").toLowerCase()}
                  </span>
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
