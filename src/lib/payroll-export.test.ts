import { describe, expect, it } from "vitest";
import { cashBreakdown, dailyRateOf, fileKindOf,payPeriods, payrollFileName, periodKeyOf, sheetName, sheetOrder } from "./payroll-export";

// weekly site cut-off: Fri Nov 13 5:01 PM → Fri Nov 20 5:00 PM (Manila)
const ws = new Date("2026-11-13T09:01:00Z");
const we = new Date("2026-11-20T09:00:00Z");
const run = (over: Partial<Parameters<typeof payPeriods>[0][number]>) => ({ id: "x", projectId: null, department: null, status: "APPROVED", periodStart: ws, periodEnd: we, name: "x", net: 0, ...over });

describe("payroll Excel download", () => {
  it("puts project crews and drivers in the site file, office/engineers/architects in the office file", () => {
    expect(fileKindOf({ projectId: "rdf", department: null })).toBe("site");
    expect(fileKindOf({ projectId: null, department: "DRIVER" })).toBe("site");
    expect(fileKindOf({ projectId: null, department: "OFFICE" })).toBe("office");
    expect(fileKindOf({ projectId: null, department: "ENGINEER" })).toBe("office");
  });

  it("groups a week's approved runs into one period and names the ones still waiting", () => {
    const periods = payPeriods(
      [
        run({ id: "a", projectId: "rdf", name: "RDF Florida Farm", net: 60000 }),
        run({ id: "b", projectId: "demo", name: "Demolition of Old Structure", net: 15000, status: "PAID" }),
        run({ id: "c", department: "DRIVER", name: "Drivers", net: 8000 }),
        run({ id: "d", projectId: "x", name: "Other", status: "REVIEW" }),
        run({ id: "e", department: "OFFICE", name: "Office", periodStart: new Date("2026-11-15T16:00:00Z"), periodEnd: new Date("2026-11-30T15:59:00Z") }),
        run({ id: "f", projectId: "rdf", periodStart: new Date("2026-11-06T09:01:00Z"), periodEnd: new Date("2026-11-13T09:00:00Z"), net: 100 }),
      ],
      "site",
    );
    expect(periods.map((p) => p.key)).toEqual(["2026-11-13_2026-11-20", "2026-11-06_2026-11-13"]);
    expect(periods[0].runs.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(periods[0].waiting.map((r) => r.id)).toEqual(["d"]);
    expect(periods[0].net).toBe(83000);
    expect(periodKeyOf({ periodStart: ws, periodEnd: we })).toBe("2026-11-13_2026-11-20");
  });

  it("leaves out a period with no approved run", () => {
    expect(payPeriods([run({ status: "DRAFT", projectId: "rdf" })], "site")).toEqual([]);
  });

  it("orders sheets projects A–Z then departments, with safe unique names", () => {
    expect(sheetOrder([{ projectId: null, name: "Drivers" }, { projectId: "b", name: "RDF" }, { projectId: "a", name: "Demolition" }]).map((r) => r.name)).toEqual(["Demolition", "RDF", "Drivers"]);
    const taken = new Set<string>();
    expect(sheetName("Anita/Engr. Jacob [house]", taken)).toBe("Anita Engr. Jacob house");
    expect(sheetName("A very long project name that goes past thirty one", taken)).toHaveLength(31);
    expect(sheetName("Summary", taken)).toBe("Summary");
    expect(sheetName("summary", taken)).toBe("summary (2)");
  });

  it("breaks a net pay into bills and coins, and needs no cash when the advance is bigger", () => {
    expect(cashBreakdown(4759.38)).toEqual({ pieces: [4, 1, 1, 0, 1, 0, 0, 1, 4], centavos: 0.38 });
    expect(cashBreakdown(-500)).toEqual({ pieces: [0, 0, 0, 0, 0, 0, 0, 0, 0], centavos: 0 });
  });

  it("shows the daily rate to the peso when the hourly rate was rounded", () => {
    expect(dailyRateOf(78.13)).toBe(625);
    expect(dailyRateOf(119.32)).toBe(954.56);
  });

  it("names the file by kind and period", () => {
    expect(payrollFileName("site", "2026-11-13_2026-11-20")).toBe("Payroll - Site & Drivers - 2026-11-13 to 2026-11-20.xlsx");
  });
});
