/**
 * Enable Row-Level Security on every table in the public schema, with no
 * policies attached. Required after `prisma db push`/`migrate` on a fresh
 * database — Prisma has no concept of RLS, so it never sets this, and
 * Supabase auto-publishes every public-schema table over its REST API by
 * default. Safe to run anytime: idempotent, and this app only ever accesses
 * Postgres via Prisma (connects as the table owner, which bypasses RLS) or
 * the Supabase service-role key for Storage (also bypasses RLS by design).
 * With RLS on and zero policies, the anon/public REST API returns/affects
 * zero rows on every table — verified 2026-07-09 against the live DB.
 *
 * Usage: set DATABASE_URL/DIRECT_URL then `npx tsx scripts/enable-rls.ts`
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const tables = await prisma.$queryRawUnsafe<{ tablename: string }[]>(`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
  `);
  for (const { tablename } of tables) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "public"."${tablename}" ENABLE ROW LEVEL SECURITY;`);
    console.log("RLS enabled:", tablename);
  }
  console.log(`Done — ${tables.length} table(s).`);
  await prisma.$disconnect();
}

main();
