import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import { fmtDate } from "@/lib/format";
import { projectOrCategoryLabel } from "@/lib/requisitions";
import { buildDeliveryTallyPdf } from "@/lib/delivery-tally-pdf";

interface PoItemJson {
  name: string;
  unit: string;
}

interface ChecklistItemJson {
  item: string;
  orderedQty: number;
  receivedQty: number;
  ok: boolean;
  remarks?: string | null;
}

/**
 * GET /api/deliveries/[id]/pdf — the company's "Tally-Out of Construction
 * (Materials) (Tools & Equipment)" paper slip, rendered as a real PDF from
 * the live verified-delivery record.
 */
export const GET = handleApi(
  async (_req: NextRequest, { params }: { params: { id: string } }) => {
    await requireUser(["OWNER", "PM", "FOREMAN", "PURCHASING", "ACCOUNTING", "DRIVER"]);

    const delivery = await prisma.delivery.findUnique({
      where: { id: params.id },
      include: {
        project: { select: { name: true, address: true } },
        po: {
          select: {
            poNumber: true,
            items: true,
            requisition: { select: { category: true } },
          },
        },
      },
    });
    if (!delivery) throw new ApiError(404, "Delivery not found");

    const verifier = await prisma.user.findUnique({
      where: { id: delivery.verifiedById },
      select: { name: true },
    });

    const label =
      delivery.project?.name ??
      projectOrCategoryLabel({ project: null, category: delivery.po.requisition?.category });
    const poItems = delivery.po.items as unknown as PoItemJson[];
    const unitByName = new Map(poItems.map((i) => [i.name, i.unit]));
    const checklist = delivery.checklist as unknown as ChecklistItemJson[];

    const pdfBytes = await buildDeliveryTallyPdf({
      projectLabel: label,
      location: delivery.project?.address || label,
      date: fmtDate(delivery.verifiedAt ?? delivery.createdAt),
      items: checklist.map((c) => ({
        qty: Number(c.receivedQty),
        unit: unitByName.get(c.item) ?? "",
        name: c.item,
        remarks: c.remarks || (!c.ok ? "Discrepancy" : null),
      })),
      preparedBy: verifier?.name ?? "",
      deliveredBy: delivery.driverName,
      approvedBy: null,
      receivedBy: delivery.recipientName,
    });

    const filename = `Tally-${delivery.po.poNumber.replace(/[^a-z0-9]+/gi, "-")}.pdf`;
    return new NextResponse(Buffer.from(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }
);
