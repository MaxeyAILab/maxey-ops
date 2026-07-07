import type { ProjectStatus } from "@prisma/client";

/** Project lifecycle grouping per the owner's workflow (Projects tab). */
export const PROSPECTIVE_STATUSES: ProjectStatus[] = ["SITE_SURVEY", "NOT_ACTIVE"];

export const ONGOING_STATUSES: ProjectStatus[] = [
  "MOBILIZATION",
  "ONGOING_CONSTRUCTION",
  "ON_HOLD",
  "FOR_PUNCHLIST",
];

export const COMPLETED_STATUSES: ProjectStatus[] = ["TURNED_OVER"];

/** Statuses that field forms (requisitions, attendance, etc.) can charge to. */
export const CHARGEABLE_STATUSES: ProjectStatus[] = [
  "SITE_SURVEY",
  "MOBILIZATION",
  "ONGOING_CONSTRUCTION",
  "ON_HOLD",
  "FOR_PUNCHLIST",
];

export const STATUS_LABELS: Record<ProjectStatus, string> = {
  SITE_SURVEY: "For Site Survey",
  MOBILIZATION: "Mobilization",
  ONGOING_CONSTRUCTION: "On-going Construction",
  NOT_ACTIVE: "Not Active",
  ON_HOLD: "Project On-hold",
  FOR_PUNCHLIST: "For Punchlist",
  TURNED_OVER: "Turned-over",
};

export const ALL_STATUSES = Object.keys(STATUS_LABELS) as ProjectStatus[];
