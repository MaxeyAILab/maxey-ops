import type { Role } from "@prisma/client";

/**
 * Sign-in roles for site and warehouse jobs that the basic account types do not describe. Each one is a named job that sits on one of
 * the existing account types (so every permission already built for that type keeps working) and adds what the job needs:
 *
 *  - Timekeeper: fills in the timekeeper sheet for workers without a login; logs materials movements on site.
 *  - Warehouse man: runs the warehouse — adds stock items and tools, logs every movement, and receives deliveries (Inventory and
 *    Deliveries tabs).
 *  - Leadman: leads a crew — logs materials movements on site (Inventory tab).
 *  - General Foreman: a foreman — exactly what the Foreman account type does.
 *  - On-site worker: the basic worker account — time, instructions and own pay.
 *
 * The job is stored beside the account type (User.jobRole). Pure, so the forms, the API and the tests share it.
 */
export type JobRole = "TIMEKEEPER" | "WAREHOUSEMAN" | "LEADMAN" | "GENERAL_FOREMAN" | "SITE_WORKER";

export interface JobRoleInfo {
  label: string;
  /** the account type it sits on — what every other part of the app sees */
  role: Role;
  /** tabs it gets on top of that account type's own */
  extraTabs: string[];
  /** a position to suggest when the person has none */
  position: string;
  hint: string;
}

export const JOB_ROLES: Record<JobRole, JobRoleInfo> = {
  TIMEKEEPER: { label: "Timekeeper", role: "OFFICE", extraTabs: ["/inventory"], position: "Timekeeper", hint: "Fills in the timekeeper sheet and logs materials on site." },
  WAREHOUSEMAN: { label: "Warehouse man", role: "OFFICE", extraTabs: ["/inventory", "/deliveries"], position: "Warehouseman", hint: "Runs the warehouse: stock, tools, movements and receiving deliveries." },
  LEADMAN: { label: "Leadman", role: "OFFICE", extraTabs: ["/inventory"], position: "Leadman", hint: "Leads a crew and logs materials on site." },
  GENERAL_FOREMAN: { label: "General Foreman", role: "FOREMAN", extraTabs: [], position: "General Foreman", hint: "A foreman: requisitions, deliveries, inventory, progress." },
  SITE_WORKER: { label: "On-site worker", role: "OFFICE", extraTabs: [], position: "Worker", hint: "Time, instructions and their own pay." },
};

export const JOB_ROLE_KEYS = Object.keys(JOB_ROLES) as JobRole[];
export const isJobRole = (v: unknown): v is JobRole => typeof v === "string" && (JOB_ROLE_KEYS as string[]).includes(v);

/** The job roles that may log materials movements on site and in the warehouse (with the Inventory tab). */
export const INVENTORY_JOB_ROLES: JobRole[] = ["TIMEKEEPER", "LEADMAN", "WAREHOUSEMAN"];

/** The tabs a new account of this job starts with: its account type's own plus the job's extras (the Owner can still tick any tab). */
export function jobRoleTabs(job: JobRole, baseTabs: string[]): string[] {
  return Array.from(new Set([...baseTabs, ...JOB_ROLES[job].extraTabs]));
}

/** What to store when the Owner picks a job: the account type it sits on, and the job itself. A plain account type has no job. */
export function resolveAccess(pick: { role?: Role | null; jobRole?: string | null }): { role: Role | null; jobRole: JobRole | null } {
  if (isJobRole(pick.jobRole)) return { role: JOB_ROLES[pick.jobRole].role, jobRole: pick.jobRole };
  return { role: pick.role ?? null, jobRole: null };
}

export const jobRoleLabel = (v: string | null | undefined): string | null => (isJobRole(v) ? JOB_ROLES[v].label : null);
