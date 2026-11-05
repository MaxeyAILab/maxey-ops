/**
 * Project input (People page switch `projectInput`): lets a person who is not a PM/Foreman — such as a Project Engineer on an office
 * account — put things into the projects they work on, without seeing any money:
 *   progress updates (reviewed by the PM/Owner like a foreman's), daily construction reports, new documents (kept internal),
 *   and potential changes (internal, not sent to the client, no cost).
 * The Owner and PM always may; a Foreman keeps the progress and daily-report input that role has always had.
 * Money (contract, committed cost, margin) and sending a change order to the client stay with the Owner/PM — see project page showMoney.
 */
export interface ProjectInputPerson {
  role: string;
  projectInput?: boolean | null;
}

/** Progress updates and daily construction reports. */
export const canInputProgress = (u: ProjectInputPerson): boolean => ["OWNER", "PM", "FOREMAN"].includes(u.role) || !!u.projectInput;

/** Registering a new document (and uploading its file). */
export const canAddDocument = (u: ProjectInputPerson): boolean => ["OWNER", "PM"].includes(u.role) || !!u.projectInput;

/** Logging a potential change (internal). Pricing it and sending it to the client is Owner/PM only. */
export const canLogPotentialChange = (u: ProjectInputPerson): boolean => ["OWNER", "PM"].includes(u.role) || !!u.projectInput;

/** Owner and PM: share documents with the client, send change orders, see the money. */
export const isProjectManagerRole = (u: ProjectInputPerson): boolean => ["OWNER", "PM"].includes(u.role);
