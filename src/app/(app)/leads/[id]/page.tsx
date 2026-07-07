import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { daysSince, fmtDate, fmtDateTime } from "@/lib/format";
import { Badge, Card, CardBody, CardHeader } from "@/components/ui";
import { ConvertLeadForm, LeadStatusSelect, QuotationBuilder } from "@/components/lead-actions";

export const dynamic = "force-dynamic";

export default async function LeadDetailPage({ params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user || user.role !== "OWNER") redirect("/attendance"); // Owner-only

  const lead = await prisma.lead.findUnique({
    where: { id: params.id },
    include: {
      quotations: { orderBy: { createdAt: "desc" }, include: { lineItems: true } },
      projects: { select: { id: true, name: true } },
    },
  });
  if (!lead) notFound();

  const canEdit = ["OWNER", "PM", "OFFICE"].includes(user.role);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/leads" className="text-xs text-ink-400 hover:text-ink-600">
            ← All leads
          </Link>
          <h1 className="text-xl font-bold text-ink-900">{lead.contactName}</h1>
          <p className="text-xs text-ink-500">
            Inquired {fmtDateTime(lead.createdAt)} · waiting {daysSince(lead.createdAt)} day(s) ·
            estimate due {fmtDate(lead.estimateDueBy)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge value={lead.source} />
          {canEdit && <LeadStatusSelect leadId={lead.id} current={lead.status} />}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Inquiry details" />
          <CardBody className="space-y-2 text-sm">
            <p>
              <span className="font-medium text-ink-500">Email:</span> {lead.email ?? "—"}
            </p>
            <p>
              <span className="font-medium text-ink-500">Phone:</span> {lead.phone ?? "—"}
            </p>
            <p>
              <span className="font-medium text-ink-500">Location:</span> {lead.address ?? "—"}
            </p>
            <p className="whitespace-pre-wrap rounded-lg bg-ink-50 p-3 text-ink-700">
              {lead.message ?? "No message."}
            </p>
          </CardBody>
        </Card>

        {canEdit && lead.projects.length === 0 && (
          <Card>
            <CardHeader
              title="Convert to project"
              subtitle="Marks the lead as Won and seeds payment terms (downpayment / progress / retention)"
            />
            <CardBody>
              <ConvertLeadForm leadId={lead.id} />
            </CardBody>
          </Card>
        )}
        {lead.projects.length > 0 && (
          <Card>
            <CardHeader title="Project" />
            <CardBody>
              {lead.projects.map((p) => (
                <Link
                  key={p.id}
                  href={`/projects/${p.id}`}
                  className="font-medium text-brand-600 hover:underline"
                >
                  {p.name} →
                </Link>
              ))}
            </CardBody>
          </Card>
        )}
      </div>

      <Card>
        <CardHeader
          title={`Quotations (${lead.quotations.length})`}
          subtitle="Branded PDF export available on each quotation page"
        />
        <CardBody className="space-y-3">
          {lead.quotations.map((q) => {
            const subtotal = q.lineItems.reduce(
              (s, li) => s + Number(li.qty) * Number(li.unitPrice),
              0
            );
            return (
              <div
                key={q.id}
                className="flex items-center justify-between rounded-lg border border-ink-100 px-4 py-3"
              >
                <div>
                  <Link
                    href={`/quotations/${q.id}`}
                    className="font-medium text-brand-600 hover:underline"
                  >
                    {q.number}
                  </Link>
                  <div className="text-xs text-ink-400">
                    {q.lineItems.length} line item(s) · created {fmtDate(q.createdAt)}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm tabular-nums text-ink-600">
                    ₱{subtotal.toLocaleString("en-PH", { minimumFractionDigits: 2 })} + markup/VAT
                  </span>
                  <Badge value={q.status} />
                </div>
              </div>
            );
          })}
          {canEdit && (
            <details className="rounded-lg border border-dashed border-ink-200 p-4" open={lead.quotations.length === 0}>
              <summary className="cursor-pointer text-sm font-medium text-ink-700">
                + New quotation
              </summary>
              <div className="mt-4">
                <QuotationBuilder leadId={lead.id} />
              </div>
            </details>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
