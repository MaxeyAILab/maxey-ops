import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ApiError, handleApi, requireUser } from "@/lib/rbac";

const schema = z.object({
  decision: z.enum(["APPROVED", "QUERIED"]),
  note: z.string().trim().max(2000).optional(),
});

/**
 * POST /api/progress/[id]/review — PM/Owner approves a submitted progress
 * entry or queries it back to the submitter (a note is required for a query).
 * Only SUBMITTED entries can be reviewed. The status change is a conditional
 * update, so a double click or two reviewers at once can only apply it once;
 * repeating an approval that already happened is a harmless no-op. An approved
 * entry is never re-queried — it is corrected through the edit route, which
 * records before/after values.
 */
export const POST = handleApi(
  async (req: NextRequest, { params }: { params: { id: string } }) => {
    const user = await requireUser(["OWNER", "PM"]);
    const body = schema.parse(await req.json());
    if (body.decision === "QUERIED" && (!body.note || body.note.length < 3)) {
      throw new ApiError(400, "Add a note explaining what needs to be fixed or clarified");
    }

    const entry = await prisma.progressEntry.findUnique({
      where: { id: params.id },
      include: { project: { select: { name: true } } },
    });
    if (!entry) throw new ApiError(404, "Progress entry not found");

    if (entry.reviewStatus === body.decision) {
      return NextResponse.json({ ok: true, alreadyDone: true, status: entry.reviewStatus });
    }
    if (entry.reviewStatus !== "SUBMITTED") {
      throw new ApiError(
        409,
        entry.reviewStatus === "APPROVED"
          ? "This entry is already approved — correct it instead of re-reviewing"
          : "This entry is queried and waiting for the submitter to resubmit"
      );
    }

    const result = await prisma.progressEntry.updateMany({
      where: { id: params.id, reviewStatus: "SUBMITTED" },
      data: {
        reviewStatus: body.decision,
        reviewedById: user.id,
        reviewedAt: new Date(),
        reviewNote: body.decision === "QUERIED" ? body.note : null,
      },
    });
    if (result.count === 0) {
      const now = await prisma.progressEntry.findUnique({ where: { id: params.id } });
      if (now?.reviewStatus === body.decision) {
        return NextResponse.json({ ok: true, alreadyDone: true, status: now.reviewStatus });
      }
      throw new ApiError(409, "This entry was just reviewed by someone else — refresh the page");
    }

    await audit({
      entityType: "ProgressEntry",
      entityId: entry.id,
      actorId: user.id,
      actorName: user.name,
      action: body.decision === "APPROVED" ? "PROGRESS_APPROVED" : "PROGRESS_QUERIED",
      diff: {
        project: entry.project.name,
        workItem: entry.workItem,
        pctComplete: Number(entry.pctComplete),
        note: body.note ?? null,
      },
    });

    return NextResponse.json({ ok: true, status: body.decision });
  }
);
