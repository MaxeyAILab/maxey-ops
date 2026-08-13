import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fmtDateTime, php } from "@/lib/format";
import { Badge, Button, Card, CardHeader, Table, Td, Th } from "@/components/ui";
import { DeleteRequisitionButton } from "@/components/requisition-actions";
import { projectOrCategoryLabel, requisitionAmount } from "@/lib/requisitions";

export const metadata = { title: "Requisitions" };
export const dynamic = "force-dynamic";

const MONTH_FMT = new Intl.DateTimeFormat("en-PH", {
  month: "long",
  year: "numeric",
  timeZone: "Asia/Manila",
});

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
      approvedBy: { select: { name: true } },
      purchaseOrder: { select: { poNumber: true, totalCost: true } },
    },
  });

  const actionable = requisitions.filter((r) =>
    ["SUBMITTED", "UNDER_REVIEW"].includes(r.status)
  );

  // Rejections have no dedicated actor/timestamp columns on Requisition — the
  // append-only audit log already recorded who rejected it and when.
  const rejectedIds = requisitions.filter((r) => r.status === "REJECTED").map((r) => r.id);
  const rejectionLogs = rejectedIds.length
    ? await prisma.auditLog.findMany({
        where: { entityType: "Requisition", entityId: { in: rejectedIds }, action: "REQUISITION_REJECTED" },
        orderBy: { createdAt: "desc" },
      })
    : [];
  const rejectionByReqId = new Map(rejectionLogs.map((l) => [l.entityId, l]));

  function decidedInfo(r: (typeof requisitions)[number]): { date: Date | null; by: string | null } {
    if (r.status === "REJECTED") {
      const log = rejectionByReqId.get(r.id);
      return { date: log?.createdAt ?? null, by: log?.actorName ?? null };
    }
    return { date: r.approvedAt, by: r.approvedBy?.name ?? null };
  }

  // Archive resolved (approved or rejected) requisitions into monthly folders,
  // each showing how much was approved vs. rejected that month.
  type Row = (typeof requisitions)[number];
  interface Folder {
    key: string;
    label: string;
    approvedCount: number;
    approvedTotal: number;
    rejectedCount: number;
    rejectedTotal: number;
    items: Row[];
  }
  const folderMap = new Map<string, Folder>();
  for (const r of requisitions) {
    if (!r.approvedAt && r.status !== "REJECTED") continue; // still pending — not resolved yet
    const d = new Date(r.submittedAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    let folder = folderMap.get(key);
    if (!folder) {
      folder = {
        key,
        label: MONTH_FMT.format(d),
        approvedCount: 0,
        approvedTotal: 0,
        rejectedCount: 0,
        rejectedTotal: 0,
        items: [],
      };
      folderMap.set(key, folder);
    }
    folder.items.push(r);
    if (r.status === "REJECTED") {
      folder.rejectedCount += 1;
      folder.rejectedTotal += requisitionAmount(r);
    } else {
      folder.approvedCount += 1;
      folder.approvedTotal += requisitionAmount(r);
    }
  }
  const folders = Array.from(folderMap.values()).sort((a, b) => (a.key < b.key ? 1 : -1));

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
              {user.role === "OWNER" && <Th></Th>}
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
                <Td>
                  {r.project ? (
                    r.project.name
                  ) : (
                    <span className="text-amber-600">{projectOrCategoryLabel(r)}</span>
                  )}
                </Td>
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
                {user.role === "OWNER" && (
                  <Td>
                    {!r.purchaseOrder && (
                      <DeleteRequisitionButton requisitionId={r.id} compact />
                    )}
                  </Td>
                )}
              </tr>
            ))}
            {requisitions.length === 0 && (
              <tr>
                <Td colSpan={user.role === "OWNER" ? 8 : 7} className="py-8 text-center text-ink-400">
                  No requisitions yet.
                </Td>
              </tr>
            )}
          </tbody>
        </Table>
      </Card>

      {folders.length > 0 && (
        <Card>
          <CardHeader
            title="Approved & Rejected — by month"
            subtitle="Resolved requisitions archived by month, with totals"
          />
          <div className="divide-y divide-ink-100">
            {folders.map((f) => (
              <details key={f.key} className="group">
                <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-ink-50 sm:px-5">
                  <div className="flex items-center gap-2">
                    <span className="text-ink-400 transition-transform group-open:rotate-90">▶</span>
                    <span className="font-semibold text-ink-900">{f.label}</span>
                  </div>
                  <div className="flex flex-wrap justify-end gap-x-4 gap-y-1 text-xs">
                    {f.approvedCount > 0 && (
                      <span className="font-medium text-emerald-700">
                        {f.approvedCount} approved · {php(f.approvedTotal)}
                      </span>
                    )}
                    {f.rejectedCount > 0 && (
                      <span className="font-medium text-red-600">
                        {f.rejectedCount} rejected · {php(f.rejectedTotal)}
                      </span>
                    )}
                  </div>
                </summary>
                <div className="border-t border-ink-100 px-4 py-2 sm:px-5">
                  <Table>
                    <thead>
                      <tr>
                        <Th>Submitted</Th>
                        <Th>Requested by</Th>
                        <Th>Project</Th>
                        <Th>Decided</Th>
                        <Th>Decided by</Th>
                        <Th className="text-right">Amount</Th>
                        <Th>Status</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {f.items.map((r) => {
                        const decided = decidedInfo(r);
                        return (
                          <tr key={r.id} className="hover:bg-ink-50">
                            <Td>
                              <Link
                                href={`/requisitions/${r.id}`}
                                className="font-medium text-brand-600 hover:underline"
                              >
                                {fmtDateTime(r.submittedAt)}
                              </Link>
                            </Td>
                            <Td>{r.submittedBy.name}</Td>
                            <Td>
                              {r.project ? (
                                r.project.name
                              ) : (
                                <span className="text-amber-600">{projectOrCategoryLabel(r)}</span>
                              )}
                            </Td>
                            <Td>{fmtDateTime(decided.date)}</Td>
                            <Td>{decided.by ?? "—"}</Td>
                            <Td className="text-right tabular-nums">
                              {php(requisitionAmount(r))}
                            </Td>
                            <Td>
                              <Badge value={r.status} />
                            </Td>
                          </tr>
                        );
                      })}
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
