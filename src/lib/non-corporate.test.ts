import { describe, expect, it } from "vitest";
import { nonCorporateCharge, runNonCorporateTotal, type PayrollEntry } from "./payroll";
import { corporateRunGross, runGross } from "./finance";
import { CATEGORY_LABELS, GA_LABEL, NON_PROJECT_CATEGORIES, projectOrCategoryLabel } from "./requisitions";

const entry = (over: Partial<PayrollEntry> = {}): PayrollEntry => ({
  userId: "d1",
  name: "Zoilo",
  daysWorked: 6,
  regularHours: 48,
  otHours: 4,
  hourlyRate: 91.25,
  gross: 4745,
  sss: 0,
  philhealth: 0,
  pagibig: 0,
  meals: 0,
  cashAdvance: 0,
  net: 4745,
  ...over,
});

describe("requisition sections", () => {
  it("groups the no-project choices under General & Administrative as Office, Warehouse, Emergency", () => {
    expect(GA_LABEL).toBe("General & Administrative");
    expect(NON_PROJECT_CATEGORIES.map((c) => c.label)).toEqual(["Office", "Warehouse", "Emergency"]);
  });

  it("keeps the stored categories, only the wording changed", () => {
    expect(NON_PROJECT_CATEGORIES.map((c) => c.value)).toEqual(["OFFICE_SUPPLY", "WAREHOUSE_SUPPLY", "EMERGENCY"]);
    expect(CATEGORY_LABELS).toEqual({ OFFICE_SUPPLY: "Office", WAREHOUSE_SUPPLY: "Warehouse", EMERGENCY: "Emergency" });
  });

  it("shows a requisition's charge as the project name or as G&A · category", () => {
    expect(projectOrCategoryLabel({ project: { name: "Calauan Public Market" } })).toBe("Calauan Public Market");
    expect(projectOrCategoryLabel({ category: "OFFICE_SUPPLY" })).toBe("G&A · Office");
    expect(projectOrCategoryLabel({ category: "WAREHOUSE_SUPPLY" })).toBe("G&A · Warehouse");
    expect(projectOrCategoryLabel({ category: "EMERGENCY" })).toBe("G&A · Emergency");
    expect(projectOrCategoryLabel({})).toBe("G&A · Emergency");
  });
});

describe("driver hours charged to a non-corporate job", () => {
  it("is zero when nothing is assigned", () => {
    expect(nonCorporateCharge(entry())).toBe(0);
  });

  it("is the hours assigned there at the driver's rate", () => {
    expect(nonCorporateCharge(entry({ nonCorporate: { jobId: "j1", jobName: "Owner's house", hours: 20 } }))).toBe(1825); // 20 x 91.25
  });

  it("can be the whole line, and can never exceed the hours worked", () => {
    expect(nonCorporateCharge(entry({ nonCorporate: { jobId: "j1", jobName: "x", hours: 52 } }))).toBe(4745);
    expect(nonCorporateCharge(entry({ nonCorporate: { jobId: "j1", jobName: "x", hours: 80 } }))).toBe(4745); // capped at 52 hrs
    expect(nonCorporateCharge(entry({ nonCorporate: { jobId: "j1", jobName: "x", hours: -5 } }))).toBe(0);
  });

  it("totals across a run", () => {
    const entries = [entry({ nonCorporate: { jobId: "j1", jobName: "x", hours: 20 } }), entry({ userId: "d2", nonCorporate: { jobId: "j2", jobName: "y", hours: 10 } }), entry({ userId: "d3" })];
    expect(runNonCorporateTotal(entries)).toBe(2737.5); // 1825 + 912.5
  });

  it("is taken out of what the run costs the company's operations", () => {
    const entries = [entry({ nonCorporate: { jobId: "j1", jobName: "x", hours: 20 } }), entry({ userId: "d2", gross: 3375, net: 3375, regularHours: 36, otHours: 0, hourlyRate: 93.75 })];
    expect(runGross(entries)).toBe(8120);
    expect(corporateRunGross(entries)).toBe(6295); // 8,120 less the 1,825 charged to the job
    expect(corporateRunGross([entry()])).toBe(4745); // nothing assigned: unchanged
  });
});
