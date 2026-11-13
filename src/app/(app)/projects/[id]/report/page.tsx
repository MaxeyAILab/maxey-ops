import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { canAccess } from "@/lib/access";
import { canAddDocument, isProjectManagerRole } from "@/lib/project-input";
import { Card, CardBody, CardHeader } from "@/components/ui";
import { RemoveProgressReportButton, UploadProgressReportForm } from "@/components/progress-report-files";

export const dynamic = "force-dynamic";

const ymd = (d: Date) => d.toISOString().slice(0, 10);
/** A @db.Date shown as the calendar day it was saved as (stored at UTC midnight). */
const day = (d: Date) => fmtDate(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/**
 * Project progress reports — PDFs uploaded by the Project Engineer, PM or Owner, one per reporting period
 * (owner's request 2026-11-13: these replace the auto-compiled report for now; that one is kept at ./compiled).
 */
export default async function ProjectProgressReportsPage({ params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!canAccess(user.role, user.department, "/projects", user.customMenus, user.useCustomMenus)) redirect("/attendance");

  const p = await prisma.project.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      name: true,
      startDate: true,
      client: { select: { name: true } },
      progressReportFiles: { orderBy: [{ periodTo: "desc" }, { createdAt: "desc" }] },
    },
  });
  if (!p) notFound();

  const canUpload = canAddDocument(user);
  const reports = p.progressReportFiles;
  const latest = reports[0];
  const nextFrom = latest
    ? ymd(new Date(latest.periodTo.getTime() + 86_400_000))
    : p.startDate
      ? p.startDate.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }) // YYYY-MM-DD, the day it is in the Philippines
      : undefined;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <Link href={`/projects/${p.id}`} className="text-xs text-ink-400 hover:text-ink-600">
          ← Back to project
        </Link>
        <h1 className="text-xl font-bold text-ink-900">Progress reports</h1>
        <p className="text-xs text-ink-500">
          {p.name} · {p.client.name}
        </p>
      </div>

      <Card>
        <CardHeader title={`Uploaded reports (${reports.length})`} />
        <CardBody>
          {reports.length === 0 ? (
            <p className="text-sm text-ink-500">
              No progress report uploaded yet.{canUpload ? " Upload the first one below." : " The Project Engineer, PM or Owner uploads them here."}
            </p>
          ) : (
            <ul className="divide-y divide-ink-100">
              {reports.map((r) => {
                const period = `${day(r.periodFrom)} – ${day(r.periodTo)}`;
                const canRemove = canUpload && (isProjectManagerRole(user) || r.uploadedById === user.id);
                return (
                  <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-ink-900">{period}</div>
                      <div className="text-sm text-ink-700">{r.title}</div>
                      <div className="text-xs text-ink-500">
                        Uploaded by {r.uploadedByName} · {fmtDateTime(r.createdAt)}
                        {r.fileName && <> · {r.fileName}</>}
                      </div>
                      {r.notes && <div className="mt-0.5 text-xs text-ink-600">{r.notes}</div>}
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-[36px] items-center rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
                      >
                        📄 Open PDF
                      </a>
                      {canRemove && <RemoveProgressReportButton id={r.id} label={period} />}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      {canUpload && (
        <Card>
          <CardHeader title="Upload a progress report" />
          <CardBody>
            <UploadProgressReportForm projectId={p.id} defaultFrom={nextFrom} />
          </CardBody>
        </Card>
      )}
    </div>
  );
}
