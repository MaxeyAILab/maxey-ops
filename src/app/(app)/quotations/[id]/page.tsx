import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fmtDate, php } from "@/lib/format";
import { Badge } from "@/components/ui";
import { QuotationStatusButton } from "@/components/lead-actions";
import { PrintButton } from "@/components/print-button";

export const dynamic = "force-dynamic";

/**
 * Branded, print-ready quotation (Spec 6.1). "Download PDF" uses the browser
 * print dialog — letterhead styling is preserved via print CSS.
 */
export default async function QuotationPage({ params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user || user.role !== "OWNER") redirect("/attendance"); // Owner-only (part of Leads)

  const q = await prisma.quotation.findUnique({
    where: { id: params.id },
    include: {
      lead: true,
      createdBy: { select: { name: true } },
      lineItems: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!q) notFound();

  const subtotal = q.lineItems.reduce((s, li) => s + Number(li.qty) * Number(li.unitPrice), 0);
  const markup = subtotal * (Number(q.markupPct) / 100);
  const vat = (subtotal + markup) * (Number(q.vatPct) / 100);
  const total = subtotal + markup + vat;

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <Link href={`/leads/${q.leadId}`} className="text-xs text-ink-400 hover:text-ink-600">
          ← Back to lead
        </Link>
        <div className="flex items-center gap-2">
          <Badge value={q.status} />
          <QuotationStatusButton quotationId={q.id} status={q.status} />
          <PrintButton />
        </div>
      </div>

      {/* Letterhead document */}
      <div className="mx-auto max-w-3xl rounded-xl border border-ink-200 bg-white p-8 shadow-sm print:border-0 print:shadow-none">
        <div className="flex items-start justify-between border-b-4 border-brand-500 pb-5">
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-brand-500 text-xl font-black text-white">
              M
            </span>
            <div>
              <div className="text-xl font-black tracking-tight text-ink-900">
                MAXEY CONSTRUCTION
              </div>
              <div className="text-xs text-ink-500">
                374 Malapit, San Isidro, Nueva Ecija · PCAB Registered
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-lg font-bold text-brand-600">QUOTATION</div>
            <div className="text-sm font-medium text-ink-700">{q.number}</div>
            <div className="text-xs text-ink-400">{fmtDate(q.createdAt)}</div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-xs font-semibold uppercase text-ink-400">Prepared for</div>
            <div className="font-medium text-ink-900">{q.lead.contactName}</div>
            <div className="text-ink-500">{q.lead.address ?? ""}</div>
            <div className="text-ink-500">{q.lead.phone ?? q.lead.email ?? ""}</div>
          </div>
          <div className="text-right">
            <div className="text-xs font-semibold uppercase text-ink-400">Valid until</div>
            <div className="font-medium text-ink-900">{fmtDate(q.validUntil)}</div>
            <div className="mt-1 text-xs text-ink-400">Prepared by {q.createdBy.name}</div>
          </div>
        </div>

        <table className="mt-6 w-full text-sm">
          <thead>
            <tr className="border-b-2 border-ink-200 text-left text-xs uppercase tracking-wide text-ink-500">
              <th className="py-2">#</th>
              <th className="py-2">Description</th>
              <th className="py-2">Category</th>
              <th className="py-2 text-right">Qty</th>
              <th className="py-2 text-right">Unit</th>
              <th className="py-2 text-right">Unit Price</th>
              <th className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {q.lineItems.map((li, i) => (
              <tr key={li.id} className="border-b border-ink-100">
                <td className="py-2 text-ink-400">{i + 1}</td>
                <td className="py-2 font-medium text-ink-800">{li.description}</td>
                <td className="py-2 text-ink-500">{li.category.toLowerCase()}</td>
                <td className="py-2 text-right tabular-nums">{Number(li.qty)}</td>
                <td className="py-2 text-right">{li.unit}</td>
                <td className="py-2 text-right tabular-nums">{php(li.unitPrice)}</td>
                <td className="py-2 text-right tabular-nums">
                  {php(Number(li.qty) * Number(li.unitPrice))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 ml-auto w-64 space-y-1 text-sm">
          <div className="flex justify-between text-ink-600">
            <span>Subtotal</span>
            <span className="tabular-nums">{php(subtotal)}</span>
          </div>
          <div className="flex justify-between text-ink-600">
            <span>Markup ({Number(q.markupPct)}%)</span>
            <span className="tabular-nums">{php(markup)}</span>
          </div>
          <div className="flex justify-between text-ink-600">
            <span>VAT ({Number(q.vatPct)}%)</span>
            <span className="tabular-nums">{php(vat)}</span>
          </div>
          <div className="flex justify-between border-t-2 border-ink-900 pt-1 text-base font-bold text-ink-900">
            <span>TOTAL</span>
            <span className="tabular-nums">{php(total)}</span>
          </div>
        </div>

        {q.notes && (
          <p className="mt-6 whitespace-pre-wrap rounded-lg bg-ink-50 p-3 text-xs text-ink-600 print:bg-transparent print:p-0">
            {q.notes}
          </p>
        )}

        <div className="mt-10 text-xs text-ink-400">
          This quotation is valid until the date indicated above. Prices are subject to
          re-validation thereafter. Thank you for considering Maxey Construction.
        </div>
      </div>
    </div>
  );
}
