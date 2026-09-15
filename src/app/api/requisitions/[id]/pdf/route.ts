import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import { fmtDate } from "@/lib/format";
import { projectOrCategoryLabel } from "@/lib/requisitions";
import { buildRequisitionPdf } from "@/lib/requisition-pdf";

/**
 * GET /api/requisitions/[id]/pdf — the company's "Requisition for Tools and
 * Materials" paper slip, rendered as a real PDF from the live record. Same
 * access as the requisition detail page it hangs off of.
 */
export const GET = handleApi(
  async (_req: NextRequest, { params }: { params: { id: string } }) => {
    const user = await requireUser(["OWNER", "PM", "FOREMAN", "PURCHASING", "ACCOUNTING", "DRIVER"]);

    const r = await prisma.requisition.findUnique({
      where: { id: params.id },
      include: {
        items: true,
        project: { select: { name: true, address: true } },
        submittedBy: { select: { name: true } },
        approvedBy: { select: { name: true } },
      },
    });
    if (!r) throw new ApiError(404, "Requisition not found");
    if (user.role === "FOREMAN" && r.submittedBy.name !== user.name) {
      throw new ApiError(403, "Not authorized to view this requisition");
    }

    const label = projectOrCategoryLabel(r);
    const pdfBytes = await buildRequisitionPdf({
      projectLabel: label,
      location: r.project?.address || label,
      date: fmtDate(r.submittedAt),
      items: r.items.map((i) => ({
        qty: Number(i.qty),
        unit: i.unit,
        name: i.name,
        spec: i.spec,
        remarks: i.remarks,
      })),
      requestedBy: r.submittedBy.name,
      approvedBy: r.approvedBy?.name ?? null,
      approvedDate: r.approvedAt ? fmtDate(r.approvedAt) : null,
    });

    const filename = `Requisition-${label.replace(/[^a-z0-9]+/gi, "-")}-${fmtDate(r.submittedAt).replace(/[^a-z0-9]+/gi, "-")}.pdf`;
    return new NextResponse(Buffer.from(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }
);
