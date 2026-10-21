// Pure wording for inventory requests — no database or sign-in code, so it can be used anywhere without import cycles.

/** The label shown for a pending/decided request, e.g. "Return to warehouse". */
export const REQUEST_LABEL: Record<string, string> = {
  SITE_TO_WAREHOUSE: "Return to warehouse",
  SITE_TO_SITE: "Transfer to project",
  RETURN_TO_WAREHOUSE: "Return to warehouse",
  TRANSFER_SITE_TO_SITE: "Transfer to project",
};

/** What the approval step says about one request's state, for the movement logs. */
export function decisionText(m: { status: string; decidedByName?: string | null; decidedAt?: Date | null; rejectedReason?: string | null }, fmt: (d: Date) => string): string | null {
  if (m.status === "PENDING") return "Waiting for approval";
  if (m.status === "REJECTED") return `Rejected${m.decidedByName ? ` by ${m.decidedByName}` : ""}${m.decidedAt ? ` · ${fmt(m.decidedAt)}` : ""}${m.rejectedReason ? ` — ${m.rejectedReason}` : ""}`;
  if (m.decidedByName) return `Approved by ${m.decidedByName}${m.decidedAt ? ` · ${fmt(m.decidedAt)}` : ""}`;
  return null;
}
