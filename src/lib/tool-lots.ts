import type { Prisma, ToolStatus } from "@prisma/client";
import { ApiError } from "@/lib/rbac";

/**
 * Counted tools (Scaffolding & Shoring: shoring jacks, base jacks, frames, braces, platforms…). Instead of one row per piece, each
 * item is a pool of pieces at one place — the warehouse, one project, "under repair", "lost" — kept as a ToolAsset row with a
 * quantity. Moving pieces takes the number off the pool where they are and adds it to the pool where they go (creating it if it
 * is the first time). Pools are never deleted when they reach 0, because the movement history points at them; the pages simply
 * do not show an empty pool.
 */

/** A quantity typed in a form or sent by a client: a whole number from 1 up, or null when it is not one. */
export function wholeQty(v: unknown): number | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 1_000_000 ? n : null;
}

/** Pieces of a pool still free to move: what it holds minus what other requests waiting for approval already ask for. */
export const availablePieces = (held: number, waiting: number): number => Math.max(held - waiting, 0);

/** Why a movement of `qty` pieces cannot be made now, or null when it can. */
export function shortagePhrase(name: string, qty: number, held: number, waiting: number): string | null {
  const free = availablePieces(held, waiting);
  if (qty <= free) return null;
  return `Only ${free} ${name} ${free === 1 ? "is" : "are"} available here${waiting > 0 ? ` (${waiting} more ${waiting === 1 ? "is" : "are"} already waiting for approval)` : ""} — ${qty} asked for`;
}

type Db = Prisma.TransactionClient;
interface Pool {
  id: string;
  name: string;
  category: string | null;
  warehouse: "MAIN" | "ALUA" | "VENTUS" | "BARANGAY";
}

/**
 * Moves `qty` pieces from the pool `src` to the pool at `dest` (same item, same home warehouse). Takes the pieces off the source
 * only if it still holds them — so two people moving the same pieces at once cannot both succeed — and returns the id of the
 * destination pool.
 */
export async function moveLotPieces(db: Db, src: Pool, qty: number, dest: { status: ToolStatus; currentProjectId: string | null }): Promise<string> {
  const taken = await db.toolAsset.updateMany({ where: { id: src.id, quantity: { gte: qty } }, data: { quantity: { decrement: qty } } });
  if (taken.count === 0) throw new ApiError(409, `The pieces are no longer there — ${src.name} was just moved by someone else. Reload and try again.`);
  const existing = await db.toolAsset.findFirst({
    where: { id: { not: src.id }, name: { equals: src.name, mode: "insensitive" }, category: src.category, warehouse: src.warehouse, status: dest.status, currentProjectId: dest.currentProjectId },
    select: { id: true },
  });
  if (existing) {
    await db.toolAsset.update({ where: { id: existing.id }, data: { quantity: { increment: qty } } });
    return existing.id;
  }
  const made = await db.toolAsset.create({
    data: { name: src.name, category: src.category, warehouse: src.warehouse, status: dest.status, currentProjectId: dest.currentProjectId, quantity: qty, workingStatus: "WORKING" },
  });
  return made.id;
}
