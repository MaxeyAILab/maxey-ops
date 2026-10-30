import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { savePhotos } from "@/lib/storage";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";
import { missingNames } from "@/lib/delivery-confirm";
import {
  canApproveTallyOut,
  canConfirmTallyOut,
  canDecideOwnTallyOut,
  canVerifyTallyOut,
  checkDriverRows,
  checkReceiverRows,
  movedQuantities,
  shortLines,
  shortfallText,
  type DriverRow,
  type TallyLine,
} from "@/lib/tally-out";
import { issueTallyOut, onHandOf, reservedStock } from "@/lib/tally-out-db";

const patchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve") }),
  z.object({ action: z.literal("reject"), reason: z.string().trim().min(3).max(300) }),
  z.object({ action: z.literal("cancel") }),
  // the driver verifies what was loaded, names themself and the person who will receive it on site
  z.object({
    action: z.literal("verify"),
    driverName: z.string().max(200).optional().or(z.literal("")),
    receiverId: z.string().optional().or(z.literal("")),
    recipientName: z.string().max(200).optional().or(z.literal("")),
    checklist: z.array(z.object({ itemId: z.string().min(1), countedQty: z.coerce.number().min(0).max(1_000_000), ok: z.boolean(), remarks: z.string().max(300).optional().or(z.literal("")) })).min(1).max(60),
    photos: z.array(z.string()).max(6).optional(),
  }),
  // the person receiving it on site confirms what arrived
  z.object({
    action: z.literal("confirm"),
    checklist: z.array(z.object({ itemId: z.string().min(1), receivedQty: z.coerce.number().min(0).max(1_000_000), remarks: z.string().max(300).optional().or(z.literal("")) })).min(1).max(60),
  }),
  z.object({ action: z.literal("dispute"), note: z.string().trim().min(5).max(500) }),
]);

/**
 * PATCH /api/tally-outs/[id] — the steps of a tally-out form. approve / reject: the Owner or a person the Owner allowed (never your
 * own, except the Owner); verify: the driver; confirm / dispute: the person receiving it on site. Confirming is the only step that
 * moves stock: the warehouse goes down and the project's materials list (and cost) go up by what the receiver confirmed.
 */
export const PATCH = handleApi(async (req: NextRequest, { params }: { params: { id: string } }) => {
  const user = await requireUser();
  const body = patchSchema.parse(await req.json());
  const t = await prisma.tallyOut.findUnique({ where: { id: params.id } });
  if (!t) throw new ApiError(404, "Tally-out form not found");
  const lines = t.items as unknown as TallyLine[];
  const project = await prisma.project.findUnique({ where: { id: t.projectId }, select: { name: true } });
  const projectName = project?.name ?? "";
  const mine = t.requestedById === user.id;
  const log = (action: string, diff: Record<string, unknown>) =>
    audit({ entityType: "TallyOut", entityId: t.id, actorId: user.id, actorName: user.name, action, diff: { number: t.number, project: projectName, ...diff } as never });
  const stale = () => new ApiError(409, "This form was just changed by someone else — reload the page");

  // ---------------------------------------------------------------- approve / reject
  if (body.action === "approve" || body.action === "reject") {
    if (!canApproveTallyOut(user)) throw new ApiError(403, "Only the Owner (or a person the Owner allowed) approves a tally-out form");
    if (mine && !canDecideOwnTallyOut(user)) throw new ApiError(403, "You can't decide your own tally-out form — another approver must");
    if (body.action === "approve") {
      if (t.status !== "PENDING") throw new ApiError(409, "This form was already decided");
      const [onHand, reserved] = await Promise.all([onHandOf(prisma, lines.map((l) => l.itemId)), reservedStock(prisma, t.id)]);
      const short = shortLines(lines, onHand, reserved);
      if (short.length > 0) throw new ApiError(400, `The warehouse no longer has enough: ${short.map((s) => `${s.line.name} — ${s.available} ${s.line.unit} available, ${s.line.qty} asked`).join("; ")}`);
      const done = await prisma.tallyOut.updateMany({ where: { id: t.id, status: "PENDING" }, data: { status: "APPROVED", decidedById: user.id, decidedByName: user.name, decidedAt: new Date() } });
      if (done.count === 0) throw stale();
      await log("TALLYOUT_APPROVED", { approvedBy: user.name });
      return NextResponse.json({ ok: true });
    }
    if (t.status !== "PENDING" && t.status !== "APPROVED") throw new ApiError(409, "This form can no longer be rejected");
    const done = await prisma.tallyOut.updateMany({ where: { id: t.id, status: { in: ["PENDING", "APPROVED"] } }, data: { status: "REJECTED", decidedById: user.id, decidedByName: user.name, decidedAt: new Date(), rejectedReason: body.reason } });
    if (done.count === 0) throw stale();
    await log("TALLYOUT_REJECTED", { reason: body.reason, rejectedBy: user.name });
    return NextResponse.json({ ok: true });
  }

  // ---------------------------------------------------------------- cancel
  if (body.action === "cancel") {
    const allowed = canApproveTallyOut(user) ? ["PENDING", "APPROVED", "VERIFIED"] : mine ? ["PENDING"] : [];
    if (!allowed.includes(t.status)) throw new ApiError(403, mine ? "Only an approver can cancel a form after it was approved" : "Only the person who filed it, or an approver, can cancel this");
    const done = await prisma.tallyOut.updateMany({ where: { id: t.id, status: { in: allowed as never } }, data: { status: "CANCELLED" } });
    if (done.count === 0) throw stale();
    await log("TALLYOUT_CANCELLED", { cancelledBy: user.name, wasAt: t.status });
    return NextResponse.json({ ok: true });
  }

  // ---------------------------------------------------------------- the driver verifies
  if (body.action === "verify") {
    if (!canVerifyTallyOut(user)) throw new ApiError(403, "Only a driver (or someone who verifies deliveries) can verify what was loaded");
    if (t.status !== "APPROVED") throw new ApiError(409, t.status === "PENDING" ? "This form is not approved yet" : "This form was already verified or closed");
    const driverName = (body.driverName ?? "").trim();
    const receiverId = body.receiverId || null;
    const missing = missingNames({ driverName, receiverId, recipientName: body.recipientName });
    if (missing) throw new ApiError(400, missing);
    let recipientName = (body.recipientName ?? "").trim();
    if (receiverId) {
      const receiver = await prisma.user.findUnique({ where: { id: receiverId }, select: { name: true, active: true, role: true } });
      if (!receiver || !receiver.active || receiver.role === "CLIENT") throw new ApiError(400, "Choose the receiver from the list of staff");
      recipientName = receiver.name;
    }
    const bad = checkDriverRows(lines, body.checklist as DriverRow[]);
    if (bad) throw new ApiError(400, bad);
    const photoUrls = await savePhotos(body.photos);
    const done = await prisma.tallyOut.updateMany({
      where: { id: t.id, status: "APPROVED" },
      data: { status: "VERIFIED", driverName, verifiedById: user.id, verifiedByName: user.name, verifiedAt: new Date(), verifyChecklist: body.checklist as never, verifyPhotos: photoUrls.length ? photoUrls : undefined, receiverId, recipientName },
    });
    if (done.count === 0) throw stale();
    const counted = new Map(body.checklist.map((c) => [c.itemId, c.countedQty]));
    await log("TALLYOUT_VERIFIED", { driverName, recipientName, waitingForReceiver: true, shortCounted: shortfallText(lines, counted) });
    return NextResponse.json({ ok: true });
  }

  // ---------------------------------------------------------------- the receiver reports a problem
  if (body.action === "dispute") {
    if (!canConfirmTallyOut(user, t)) throw new ApiError(403, "Only the person named as receiving this can report a problem with it");
    await prisma.tallyOut.update({ where: { id: t.id }, data: { disputedAt: new Date(), disputeNote: body.note } });
    await log("TALLYOUT_DISPUTED", { note: body.note, driverName: t.driverName });
    return NextResponse.json({ ok: true });
  }

  // ---------------------------------------------------------------- the receiver confirms: the stock moves
  if (!canConfirmTallyOut(user, t)) throw new ApiError(403, t.status === "VERIFIED" ? "Only the person named as receiving this can confirm it" : "This form is not waiting for confirmation");
  const counted = new Map((t.verifyChecklist as unknown as DriverRow[]).map((c) => [c.itemId, Number(c.countedQty)]));
  const bad = checkReceiverRows(counted, body.checklist);
  if (bad) throw new ApiError(400, bad);
  const now = new Date();
  const moved = await prisma.$transaction(async (db) => {
    const done = await db.tallyOut.updateMany({
      where: { id: t.id, status: "VERIFIED" },
      data: { status: "DELIVERED", confirmedAt: now, confirmedById: user.id, confirmedByName: user.name, receivedChecklist: body.checklist as never, disputedAt: null, disputeNote: null },
    });
    if (done.count === 0) throw stale();
    return issueTallyOut(db, { id: t.id, number: t.number, projectId: t.projectId, requestedById: t.requestedById, decidedById: t.decidedById, decidedByName: t.decidedByName, items: lines }, body.checklist);
  });
  const received = movedQuantities(body.checklist);
  await log("TALLYOUT_DELIVERED", {
    confirmedBy: user.name,
    movedToProject: moved.map((m) => `${m.qty} ${m.unit} ${m.name}`),
    shortfalls: shortfallText(lines, received),
  });
  return NextResponse.json({ ok: true, moved });
});
