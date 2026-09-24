// Shared, framework-agnostic helpers for Daily Construction Reports — safe to
// import from client components (no Prisma import) and from the cron route.

/** Reports are ephemeral: auto-deleted this many days after creation. */
export const DAILY_REPORT_LIFETIME_DAYS = 7;

export function dailyReportExpiresAt(createdAt: string | Date): Date {
  const created = typeof createdAt === "string" ? new Date(createdAt) : createdAt;
  return new Date(created.getTime() + DAILY_REPORT_LIFETIME_DAYS * 24 * 60 * 60 * 1000);
}
