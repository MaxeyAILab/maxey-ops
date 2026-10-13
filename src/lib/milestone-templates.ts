import { dayIndex } from "@/lib/milestones";

export type TemplateKey = "building" | "civil";

export interface MilestoneTemplateStep {
  title: string;
  days: number; // planned duration in calendar days
}

export const MILESTONE_TEMPLATES: Record<TemplateKey, { label: string; steps: MilestoneTemplateStep[] }> = {
  building: {
    label: "Building construction",
    steps: [
      { title: "Mobilization & site setup", days: 7 },
      { title: "Excavation & foundation", days: 30 },
      { title: "Structural frame", days: 45 },
      { title: "Roofing & enclosure", days: 21 },
      { title: "MEP rough-in", days: 30 },
      { title: "Finishes", days: 45 },
      { title: "Testing & commissioning", days: 10 },
      { title: "Punch list & turnover", days: 14 },
    ],
  },
  civil: {
    label: "Civil / road works",
    steps: [
      { title: "Mobilization & survey", days: 7 },
      { title: "Earthworks", days: 21 },
      { title: "Drainage & utilities", days: 21 },
      { title: "Base course", days: 14 },
      { title: "Pavement / concreting", days: 21 },
      { title: "Marking, signage & finishing", days: 7 },
      { title: "Punch list & turnover", days: 7 },
    ],
  },
};

const DAY = 86_400_000;

/**
 * Lays a template's steps end to end from a start day. Only FORECAST dates are produced — a
 * template is a starting point for the PM, never an approved plan, so no baseline is set (the
 * Owner does that). Each step starts the day after the previous one finishes.
 */
export function buildTemplateMilestones(key: TemplateKey, start: Date): { title: string; forecastStart: Date; forecastFinish: Date }[] {
  const out: { title: string; forecastStart: Date; forecastFinish: Date }[] = [];
  let cursor = dayIndex(start)!;
  for (const step of MILESTONE_TEMPLATES[key].steps) {
    const s = cursor;
    const f = cursor + step.days - 1;
    out.push({ title: step.title, forecastStart: new Date(s * DAY), forecastFinish: new Date(f * DAY) });
    cursor = f + 1;
  }
  return out;
}
