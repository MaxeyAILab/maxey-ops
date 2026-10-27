import type { PrismaClient } from "@prisma/client";

/**
 * The next purchase order number: one more than the highest number used this year. (Counting POs would reuse a number once an
 * earlier PO has been deleted.) Pass the transaction client when creating the PO in a transaction.
 */
export async function nextPoNumber(db: Pick<PrismaClient, "purchaseOrder">): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `PO-${year}-`;
  const used = await db.purchaseOrder.findMany({ where: { poNumber: { startsWith: prefix } }, select: { poNumber: true } });
  const highest = used.reduce((m, p) => Math.max(m, Number(p.poNumber.slice(prefix.length)) || 0), 0);
  return `${prefix}${String(highest + 1).padStart(4, "0")}`;
}

/** The supplier shown on a PO that only lists items coming out of the warehouse. */
export const WAREHOUSE_SUPPLIER = "Warehouse stock";
