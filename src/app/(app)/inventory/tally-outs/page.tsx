import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccess, canLogInventoryMovement } from "@/lib/access";
import { CHARGEABLE_STATUSES } from "@/lib/project-status";
import { fmtDateTime } from "@/lib/format";
import { warehouseLabel } from "@/lib/warehouses";
import { Badge, Card, CardBody, CardHeader } from "@/components/ui";
import { NewTallyOutForm, TallyOutActions } from "@/components/tally-out-forms";
import { reservedStock } from "@/lib/tally-out-db";
import {
  STATUS_LABEL,
  availableToPromise,
  canApproveTallyOut,
  canConfirmTallyOut,
  canDecideOwnTallyOut,
  canVerifyTallyOut,
  isOpen,
  type DriverRow,
  type ReceiverRow,
  type TallyLine,
  type TallyStatus,
} from "@/lib/tally-out";

export const metadata = { title: "Tally-out forms" };
export const dynamic = "force-dynamic";

const photoList = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);

/**
 * Tally-out forms — the only way materials leave a warehouse for a project (besides a requisition that takes stock). A form is
 * filed, approved by the Owner (or a person the Owner allowed), verified by the driver, and confirmed by the person receiving it on
 * site; only then do the warehouse and the project's materials list change.
 */
export default async function TallyOutsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role === "CLIENT" || !canAccess(user.role, user.department, "/inventory", user.customMenus, user.useCustomMenus)) redirect("/dashboard");

  const [forms, projects, items, reserved, staff] = await Promise.all([
    prisma.tallyOut.findMany({ orderBy: { createdAt: "desc" }, take: 150 }),
    prisma.project.findMany({ where: { status: { in: CHARGEABLE_STATUSES } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.warehouseItem.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, unit: true, category: true, warehouse: true, currentQty: true } }),
    reservedStock(prisma),
    prisma.user.findMany({ where: { active: true, role: { not: "CLIENT" }, NOT: { email: { endsWith: "@staff.maxeyconstruction.ph" } } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const projectName = new Map(projects.map((p) => [p.id, p.name]));
  const missingProjects = forms.map((f) => f.projectId).filter((id) => !projectName.has(id));
  if (missingProjects.length) for (const p of await prisma.project.findMany({ where: { id: { in: missingProjects } }, select: { id: true, name: true } })) projectName.set(p.id, p.name);
  const people = new Map((await prisma.user.findMany({ where: { id: { in: [...new Set(forms.map((f) => f.requestedById))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));

  const pickItems = items
    .map((i) => ({ id: i.id, name: i.name, unit: i.unit, category: i.category, qty: availableToPromise(Number(i.currentQty), reserved.get(i.id) ?? 0), tag: warehouseLabel(i.warehouse) }))
    .filter((i) => i.qty > 0);

  const canFile = canLogInventoryMovement(user);
  const approver = canApproveTallyOut(user);

  const view = forms.map((f) => {
    const mine = f.requestedById === user.id;
    const open = isOpen(f.status);
    const can = {
      approve: approver && f.status === "PENDING" && (!mine || canDecideOwnTallyOut(user)),
      reject: approver && (f.status === "PENDING" || f.status === "APPROVED") && (!mine || canDecideOwnTallyOut(user)),
      cancel: (mine && f.status === "PENDING") || (approver && open),
      verify: canVerifyTallyOut(user) && f.status === "APPROVED",
      confirm: canConfirmTallyOut(user, f),
    };
    return { f, can, needsMe: can.approve || can.verify || can.confirm };
  });
  const waitingForMe = view.filter((v) => v.needsMe);
  const inProgress = view.filter((v) => isOpen(v.f.status) && !v.needsMe);
  const closed = view.filter((v) => !isOpen(v.f.status)).slice(0, 30);

  const card = ({ f, can }: (typeof view)[number]) => {
    const lines = f.items as unknown as TallyLine[];
    const counted = new Map(((f.verifyChecklist as unknown as DriverRow[]) ?? []).map((c) => [c.itemId, Number(c.countedQty)]));
    const got = new Map(((f.receivedChecklist as unknown as ReceiverRow[]) ?? []).map((c) => [c.itemId, Number(c.receivedQty)]));
    const shots = photoList(f.verifyPhotos);
    return (
      <div key={f.id} className="rounded-lg border border-ink-100 p-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold text-ink-900">
            {f.number} <span className="font-normal text-ink-500">→ {projectName.get(f.projectId) ?? "Project"}</span>
          </span>
          <Badge value={f.status} label={STATUS_LABEL[f.status as TallyStatus]} />
        </div>
        <p className="mt-0.5 text-xs text-ink-500">
          Filed by {people.get(f.requestedById) ?? "—"} · {fmtDateTime(f.createdAt)}
          {f.note ? ` · ${f.note}` : ""}
        </p>
        <ul className="mt-2 divide-y divide-ink-100">
          {lines.map((l) => (
            <li key={l.itemId} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
              <span className="text-ink-800">{l.name}</span>
              <span className="tabular-nums text-ink-700">
                {l.qty} {l.unit}
                {counted.has(l.itemId) && counted.get(l.itemId) !== l.qty && <span className="text-amber-700"> · driver counted {counted.get(l.itemId)}</span>}
                {f.status === "DELIVERED" && <span className={got.get(l.itemId) === l.qty ? "text-emerald-700" : "text-amber-700"}> · received {got.get(l.itemId) ?? 0}</span>}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-2 space-y-0.5 text-xs text-ink-500">
          {f.decidedByName && f.status !== "PENDING" && (
            <p>
              {f.status === "REJECTED" ? "Rejected" : "Approved"} by {f.decidedByName} · {fmtDateTime(f.decidedAt)}
              {f.rejectedReason ? ` — ${f.rejectedReason}` : ""}
            </p>
          )}
          {f.verifiedAt && (
            <p>
              Verified by driver {f.driverName} (logged by {f.verifiedByName}) · {fmtDateTime(f.verifiedAt)} · receiver: {f.recipientName ?? "—"}
            </p>
          )}
          {f.confirmedAt && (
            <p>
              Confirmed received by {f.confirmedByName} · {fmtDateTime(f.confirmedAt)} — added to the project's materials list
            </p>
          )}
          {f.disputedAt && f.status === "VERIFIED" && <p className="font-medium text-red-700">Problem reported by the receiver: {f.disputeNote}</p>}
        </div>
        {shots.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {shots.map((u) => (
              <a key={u} href={u} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={u} alt="Load verified by the driver" className="h-14 w-14 rounded-md object-cover" />
              </a>
            ))}
          </div>
        )}
        <TallyOutActions
          id={f.id}
          number={f.number}
          status={f.status}
          lines={lines}
          counted={Object.fromEntries(counted)}
          receiverId={f.receiverId}
          can={can}
          staff={staff}
          myName={user.name}
          disputed={!!f.disputedAt}
        />
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <Link href="/inventory" className="text-xs text-ink-400 hover:text-ink-600">
          ← Inventory
        </Link>
        <h1 className="text-xl font-bold text-ink-900">Tally-out forms</h1>
        <p className="text-sm text-ink-500">
          Materials leave a warehouse for a project only through a form: filed → approved by the Owner → verified by the driver → confirmed by the person receiving it on site. Only then are they added to the project's materials list.
        </p>
      </div>

      {canFile && (
        <Card>
          <CardHeader title="File a tally-out form" subtitle="Choose the project and the materials. The quantities are reserved right away, but nothing moves until the last step." />
          <CardBody>
            {projects.length === 0 ? <p className="text-sm text-ink-400">There is no active project to send materials to yet.</p> : <NewTallyOutForm items={pickItems} projects={projects} />}
          </CardBody>
        </Card>
      )}

      {waitingForMe.length > 0 && (
        <Card className="border-amber-300">
          <CardHeader title={`Waiting for you (${waitingForMe.length})`} />
          <CardBody className="space-y-3">{waitingForMe.map(card)}</CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title={`In progress (${inProgress.length})`} subtitle="Filed, approved or on the way — not yet on the project's list" />
        <CardBody className="space-y-3">
          {inProgress.length === 0 ? <p className="text-sm text-ink-400">Nothing in progress.</p> : inProgress.map(card)}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Finished" subtitle="Delivered, rejected or cancelled — the latest 30" />
        <CardBody className="space-y-3">{closed.length === 0 ? <p className="text-sm text-ink-400">Nothing yet.</p> : closed.map(card)}</CardBody>
      </Card>
    </div>
  );
}
