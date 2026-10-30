import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import { canFileTallyOut } from "@/lib/access";
import { CHARGEABLE_STATUSES } from "@/lib/project-status";
import { mergeLines, shortLines } from "@/lib/tally-out";
import { nextTallyNumber, onHandOf, reservedStock } from "@/lib/tally-out-db";

const createSchema = z.object({
  clientUuid: z.string().uuid(),
  projectId: z.string().min(1),
  note: z.string().trim().max(300).nullish().or(z.literal("")),
  items: z.array(z.object({ itemId: z.string().min(1), qty: z.coerce.number().positive().max(1_000_000) })).min(1).max(60),
});

/**
 * POST /api/tally-outs — file a tally-out form: materials to leave a warehouse for a project. Nothing moves yet: the Owner (or a
 * person the Owner allowed) approves it, the driver verifies what was loaded, and the person receiving it on site confirms. The
 * quantities are reserved from the moment the form is filed so nobody else can promise the same stock. The Owner's own form is
 * approved on the spot.
 */
export const POST = handleApi(async (req: NextRequest) => {
  const user = await requireUser();
  if (!canFileTallyOut(user)) throw new ApiError(403, "Not authorized for this action");
  const body = createSchema.parse(await req.json());

  const dup = await prisma.tallyOut.findUnique({ where: { clientUuid: body.clientUuid }, select: { id: true } });
  if (dup) return NextResponse.json({ error: "Already synced", id: dup.id }, { status: 409 });

  const project = await prisma.project.findUnique({ where: { id: body.projectId }, select: { id: true, name: true, status: true } });
  if (!project) throw new ApiError(400, "Choose the project the materials are going to");
  if (!CHARGEABLE_STATUSES.includes(project.status)) throw new ApiError(400, "Materials can only go to a project that is active");

  const items = await prisma.warehouseItem.findMany({ where: { id: { in: body.items.map((i) => i.itemId) } }, select: { id: true, name: true, unit: true } });
  const byId = new Map(items.map((i) => [i.id, i]));
  for (const i of body.items) if (!byId.has(i.itemId)) throw new ApiError(404, "One of the items is not in the warehouse list");
  const lines = mergeLines(body.items.map((i) => ({ itemId: i.itemId, name: byId.get(i.itemId)!.name, unit: byId.get(i.itemId)!.unit, qty: i.qty })));
  if (lines.length === 0) throw new ApiError(400, "Add at least one item with a quantity");

  const approveNow = user.role === "OWNER";
  const created = await prisma.$transaction(async (db) => {
    const [onHand, reserved] = await Promise.all([onHandOf(db, lines.map((l) => l.itemId)), reservedStock(db)]);
    const short = shortLines(lines, onHand, reserved);
    if (short.length > 0) {
      throw new ApiError(400, `Not enough in the warehouse to promise: ${short.map((s) => `${s.line.name} — ${s.available} ${s.line.unit} available, ${s.line.qty} asked`).join("; ")}`);
    }
    const number = await nextTallyNumber(db);
    return db.tallyOut.create({
      data: {
        clientUuid: body.clientUuid,
        number,
        projectId: project.id,
        requestedById: user.id,
        note: body.note || null,
        items: lines as never,
        status: approveNow ? "APPROVED" : "PENDING",
        ...(approveNow ? { decidedById: user.id, decidedByName: user.name, decidedAt: new Date() } : {}),
      },
    });
  });

  await audit({
    entityType: "TallyOut",
    entityId: created.id,
    actorId: user.id,
    actorName: user.name,
    action: approveNow ? "TALLYOUT_APPROVED" : "TALLYOUT_SUBMITTED",
    diff: { number: created.number, project: project.name, items: lines.map((l) => `${l.qty} ${l.unit} ${l.name}`), note: body.note || null },
  });
  return NextResponse.json(created, { status: 201 });
});
