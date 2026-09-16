import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import { fmtDate } from "@/lib/format";
import { projectOrCategoryLabel } from "@/lib/requisitions";
import { buildPurchaseOrderPdf } from "@/lib/purchase-order-pdf";

interface PoItemJson {
  name: string;
  qty: number;
  unit: string;
  unitCost: number;
}

/**
 * GET /api/purchase-orders/[id]/pdf — the company's "Purchase Order" paper
 * slip, rendered as a real PDF from the live record.
 */
export const GET = handleApi(
  async (_req: NextRequest, { params }: { params: { id: string } }) => {
    await requireUser(["OWNER", "PM", "FOREMAN", "PURCHASING", "ACCOUNTING", "DRIVER"]);

    const po = await prisma.purchaseOrder.findUnique({
      where: { id: params.id },
      include: {
        createdBy: { select: { name: true } },
        requisition: {
          include: {
            project: { select: { name: true, address: true } },
            approvedBy: { select: { name: true } },
          },
        },
      },
    });
    if (!po) throw new ApiError(404, "Purchase order not found");

    const label = projectOrCategoryLabel(po.requisition);
    const items = po.items as unknown as PoItemJson[];
    const pdfBytes = await buildPurchaseOrderPdf({
      projectLabel: label,
      location: po.requisition.project?.address || label,
      supplier: po.supplier,
      date: fmtDate(po.createdAt),
      items: items.map((i) => ({ qty: Number(i.qty), unit: i.unit, name: i.name, remarks: null })),
      preparedBy: po.createdBy.name,
      approvedBy: po.requisition.approvedBy?.name ?? null,
      approvedDate: po.requisition.approvedAt ? fmtDate(po.requisition.approvedAt) : null,
    });

    const filename = `${po.poNumber.replace(/[^a-z0-9]+/gi, "-")}.pdf`;
    return new NextResponse(Buffer.from(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }
);
