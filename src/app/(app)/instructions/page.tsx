import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fmtDateTime } from "@/lib/format";
import { Badge, Card, CardBody, CardHeader } from "@/components/ui";
import { InstructionStatusButton, PostInstructionForm } from "@/components/instruction-actions";
import { CHARGEABLE_STATUSES } from "@/lib/project-status";

export const metadata = { title: "Site Instructions" };
export const dynamic = "force-dynamic";

/**
 * Site instructions log (Spec 6.6): a running daily list on the foreman's
 * device — not a buried chat thread — plus full history per project.
 */
export default async function InstructionsPage() {
  const user = await getSessionUser();
  if (!user || !["OWNER", "PM", "FOREMAN"].includes(user.role)) redirect("/projects");

  const [instructions, projects] = await Promise.all([
    prisma.siteInstruction.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        project: { select: { name: true } },
        postedBy: { select: { name: true } },
      },
    }),
    prisma.project.findMany({
      where: { status: { in: CHARGEABLE_STATUSES } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const canPost = ["OWNER", "PM"].includes(user.role);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const today = instructions.filter((i) => i.createdAt >= startOfToday);
  const open = instructions.filter((i) => i.createdAt < startOfToday && i.status !== "DONE");
  const done = instructions.filter((i) => i.createdAt < startOfToday && i.status === "DONE");

  const renderItem = (i: (typeof instructions)[number]) => (
    <div key={i.id} className="rounded-lg border border-ink-100 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs text-ink-400">
            {i.project.name} · {fmtDateTime(i.createdAt)} · by {i.postedBy.name}
          </div>
          <p className="mt-1 whitespace-pre-wrap text-sm text-ink-800">{i.text}</p>
          {i.photoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={i.photoUrl} alt="" className="mt-2 max-h-40 rounded-lg object-cover" />
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <Badge value={i.status} />
          <InstructionStatusButton instructionId={i.id} status={i.status} />
        </div>
      </div>
    </div>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-xl font-bold text-ink-900">Site Instructions</h1>

      {canPost && (
        <Card>
          <CardHeader title="Post an instruction" subtitle="Site team is notified; every status change is logged" />
          <CardBody>
            {projects.length > 0 ? (
              <PostInstructionForm projects={projects} />
            ) : (
              <p className="text-sm text-ink-400">No active projects.</p>
            )}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title={`Today (${today.length})`} subtitle="Instructions issued today" />
        <CardBody className="space-y-3">
          {today.map(renderItem)}
          {today.length === 0 && <p className="text-sm text-ink-400">Nothing new today.</p>}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={`Still open (${open.length})`}
          subtitle="Earlier instructions not yet done — surfaced until closed"
        />
        <CardBody className="space-y-3">
          {open.map(renderItem)}
          {open.length === 0 && <p className="text-sm text-ink-400">Nothing outstanding.</p>}
        </CardBody>
      </Card>

      {done.length > 0 && (
        <Card>
          <CardHeader title={`Completed (${done.length})`} />
          <CardBody className="space-y-3">{done.slice(0, 20).map(renderItem)}</CardBody>
        </Card>
      )}
    </div>
  );
}
