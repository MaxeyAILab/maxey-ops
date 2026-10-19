import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { savePhotos } from "@/lib/storage";
import { ApiError, handleApi } from "@/lib/rbac";
import { formatPettyCashNo, isCashCustodian, PETTY_CASH_CATEGORIES } from "@/lib/cash-expense";
import { requireCashExpenseUser, withNextNumber } from "@/lib/cash-expense-db";

const createSchema = z.object({
  projectId: z.string().min(1).nullable(), // null = General & Administrative (no project)
  category: z.enum(PETTY_CASH_CATEGORIES.map((c) => c.value) as [string, ...string[]]),
  amount: z.coerce.number().positive().max(1_000_000),
  purpose: z.string().trim().min(3).max(500),
  requestedById: z.string().min(1).optional(),
  receipts: z.array(z.string()).max(4).optional(),
});

/**
 * POST /api/petty-cash — file a petty cash request. Anyone with the Cash Expense tab files for themselves; the
 * custodians (Owner, Accounting) can also file on someone else's behalf. It starts PENDING for the Owner to approve.
 */
export const POST = handleApi(async (req: NextRequest) => {
  const user = await requireCashExpenseUser();
  const body = createSchema.parse(await req.json());

  const requestedById = isCashCustodian(user) && body.requestedById ? body.requestedById : user.id;
  const requester = await prisma.user.findFirst({ where: { id: requestedById, active: true, role: { not: "CLIENT" } }, select: { id: true, name: true } });
  if (!requester) throw new ApiError(400, "Requested by: pick an active staff member");

  let projectName: string | null = null;
  if (body.projectId) {
    const project = await prisma.project.findUnique({ where: { id: body.projectId }, select: { name: true } });
    if (!project) throw new ApiError(400, "Project not found");
    projectName = project.name;
  }

  const receipts = await savePhotos(body.receipts);
  const created = await withNextNumber(
    async () => (await prisma.pettyCashRequest.aggregate({ _max: { number: true } }))._max.number,
    (number) =>
      prisma.pettyCashRequest.create({
        data: {
          number,
          projectId: body.projectId,
          category: body.category as never,
          amount: body.amount,
          purpose: body.purpose,
          receipts: receipts.length ? receipts : undefined,
          requestedById: requester.id,
          createdById: user.id,
        },
      })
  );

  await audit({
    entityType: "PettyCashRequest",
    entityId: created.id,
    actorId: user.id,
    actorName: user.name,
    action: "PETTY_CASH_REQUESTED",
    diff: { no: formatPettyCashNo(created.number), project: projectName, amount: body.amount, requestedBy: requester.name, purpose: body.purpose },
  });
  return NextResponse.json(created, { status: 201 });
});
