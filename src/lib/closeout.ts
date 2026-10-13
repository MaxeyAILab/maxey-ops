/** The checklist a project works through before turnover. Owner/PM can apply it once and then add or remove items. */
export const DEFAULT_CLOSEOUT_TEMPLATE: { title: string; category: string; required: boolean }[] = [
  { title: "Final inspection completed", category: "Inspection", required: true },
  { title: "Testing and commissioning records received", category: "Inspection", required: true },
  { title: "Punch list cleared and signed off", category: "Inspection", required: true },
  { title: "As-built drawings issued", category: "Documents", required: true },
  { title: "Operation & maintenance manuals handed over", category: "Documents", required: true },
  { title: "Warranties and guarantees handed over", category: "Documents", required: true },
  { title: "Permits closed out / certificates of occupancy obtained", category: "Documents", required: true },
  { title: "Final billing issued", category: "Commercial", required: true },
  { title: "Retention release agreed with the client", category: "Commercial", required: false },
  { title: "Site cleaned and demobilised", category: "Site", required: true },
  { title: "Client acceptance / turnover certificate signed", category: "Acceptance", required: true },
];

export interface CloseoutProgress {
  total: number;
  done: number;
  requiredTotal: number;
  requiredDone: number;
  pct: number; // required items only; 0 when there are none
  ready: boolean;
  blockers: string[];
}

/**
 * Ready for turnover means every required item is done AND no defect or punch item is still
 * open. A project with no checklist is never "ready" — nothing has been confirmed.
 */
export function closeoutProgress(items: { required: boolean; done: boolean }[], openDefectsAndPunch: number): CloseoutProgress {
  const required = items.filter((i) => i.required);
  const requiredDone = required.filter((i) => i.done).length;
  const blockers: string[] = [];
  if (items.length === 0) blockers.push("No closeout checklist yet");
  if (required.length - requiredDone > 0) blockers.push(`${required.length - requiredDone} required checklist item${required.length - requiredDone === 1 ? "" : "s"} not done`);
  if (openDefectsAndPunch > 0) blockers.push(`${openDefectsAndPunch} defect or punch item${openDefectsAndPunch === 1 ? "" : "s"} still open`);
  return {
    total: items.length,
    done: items.filter((i) => i.done).length,
    requiredTotal: required.length,
    requiredDone,
    pct: required.length === 0 ? 0 : (requiredDone / required.length) * 100,
    ready: blockers.length === 0,
    blockers,
  };
}
