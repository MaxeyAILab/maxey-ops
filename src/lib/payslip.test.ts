import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import type { PayrollEntry } from "./payroll";
import { buildPayslip, daysFromHours, nextSlipRefs, slipDays, payslipDateLabel, payslipPeriodLabel, slipFileName, slipMoney, slipYear } from "./payslip";
import { SLIP_H, SLIP_W, buildPayslipsPdf } from "./payslip-pdf";

const manila = (day: string, time = "00:00") => new Date(`${day}T${time}:00+08:00`);

const entry = (over: Partial<PayrollEntry> = {}): PayrollEntry & { slipRef?: string } => ({
  userId: "u1",
  name: "Jonnel Magno",
  daysWorked: 12,
  regularHours: 91.93,
  otHours: 2.5,
  hourlyRate: 120.37,
  gross: 11365.61,
  sss: 497.94,
  philhealth: 276.64,
  pagibig: 100,
  meals: 0,
  cashAdvance: 0,
  net: 10491.03,
  slipRef: "2026-009",
  ...over,
});

const run = { periodStart: manila("2026-09-16"), periodEnd: manila("2026-09-30", "23:59"), projectName: null, approvedByName: "Jacob Villamor" };
const emp = { employeeNo: "VCDC-016", position: "Site Engineer", department: "ENGINEER" };

describe("payslip wording", () => {
  it("writes the period the way the paper form does", () => {
    expect(payslipPeriodLabel(manila("2026-09-16"), manila("2026-09-30", "23:59"))).toBe("Sept. 16-30, 2026");
    expect(payslipPeriodLabel(manila("2026-10-01"), manila("2026-10-15", "23:59"))).toBe("Oct. 1-15, 2026");
    expect(payslipPeriodLabel(manila("2026-05-01"), manila("2026-05-15", "23:59"))).toBe("May 1-15, 2026");
  });

  it("handles a weekly period that crosses a month, and one that crosses a year", () => {
    expect(payslipPeriodLabel(manila("2026-09-25", "17:01"), manila("2026-10-02", "17:00"))).toBe("Sept. 25 - Oct. 2, 2026");
    expect(payslipPeriodLabel(manila("2026-12-26", "17:01"), manila("2027-01-02", "17:00"))).toBe("Dec. 26, 2026 - Jan. 2, 2027");
  });

  it("uses the Manila calendar day, not the server's", () => {
    // 16 Sept 00:00 in Manila is still 15 Sept in UTC — the slip must say the 16th
    expect(payslipPeriodLabel(new Date("2026-09-15T16:00:00Z"), new Date("2026-09-30T15:59:00Z"))).toBe("Sept. 16-30, 2026");
    expect(payslipDateLabel(new Date("2026-09-30T15:59:00Z"))).toBe("30-Sep-26");
  });

  it("formats the date and money like the form", () => {
    expect(payslipDateLabel(manila("2026-10-15", "23:59"))).toBe("15-Oct-26");
    expect(slipMoney(13000)).toBe("13,000.00");
    expect(slipMoney(11125.5)).toBe("11,125.50");
    expect(slipMoney(0)).toBe("0.00");
  });

  it("names the file after the person or project and the period end", () => {
    expect(slipFileName("Jonnel Magno", manila("2026-09-30", "23:59"), true)).toBe("payslip-jonnel-magno-2026-09-30.pdf");
    expect(slipFileName("OFFICE", manila("2026-09-30", "23:59"), false)).toBe("payslips-office-2026-09-30.pdf");
    expect(slipFileName("!!!", manila("2026-09-30", "23:59"), true)).toBe("payslip-payslip-2026-09-30.pdf");
  });
});

describe("days on the payslip", () => {
  it("are the paid hours in 8-hour days, so they always agree with the hours", () => {
    expect(daysFromHours(104)).toBe(13);
    expect(daysFromHours(96)).toBe(12);
    expect(daysFromHours(100)).toBe(12.5);
    expect(daysFromHours(91.93)).toBe(11.49);
    expect(daysFromHours(0)).toBe(0);
  });

  it("ignore how many days someone clocked in — an edited register must still add up", () => {
    // the real case: 12 days clocked (96 hrs), Owner added the rest of the cutoff day by hand -> 104 hrs
    const m = buildPayslip(entry({ daysWorked: 12, regularHours: 104 }), emp, run);
    expect(m.earnings.days).toBe(13);
    expect(m.earnings.regularHours).toBe(104);
  });

  it("prints without trailing zeros", () => {
    expect(slipDays(13)).toBe("13");
    expect(slipDays(12.5)).toBe("12.5");
    expect(slipDays(11.49)).toBe("11.49");
    expect(slipDays(1)).toBe("1");
  });
});

describe("payslip reference numbers", () => {
  it("starts a year at 001 and counts up", () => {
    expect(nextSlipRefs([], 2026, 3)).toEqual(["2026-001", "2026-002", "2026-003"]);
  });

  it("continues after the highest number already issued that year", () => {
    expect(nextSlipRefs(["2026-001", "2026-009", "2026-004"], 2026, 2)).toEqual(["2026-010", "2026-011"]);
  });

  it("keeps each year separate and ignores blanks and junk", () => {
    expect(nextSlipRefs(["2025-120", undefined, null, "", "garbage", "2026-x", "2026-"], 2026, 1)).toEqual(["2026-001"]);
    expect(nextSlipRefs(["2026-007"], 2027, 1)).toEqual(["2027-001"]);
  });

  it("never hands out a number that is already taken", () => {
    const issued = ["2026-001", "2026-002", "2026-003"];
    const next = nextSlipRefs(issued, 2026, 5);
    for (const ref of next) expect(issued).not.toContain(ref);
    expect(new Set(next).size).toBe(5);
  });

  it("runs the year of the day the period ends", () => {
    expect(slipYear(manila("2026-12-31", "23:59"))).toBe(2026);
    expect(slipYear(manila("2027-01-02", "17:00"))).toBe(2027);
  });
});

describe("what a payslip shows", () => {
  it("carries the register's numbers without recalculating them", () => {
    const m = buildPayslip(entry(), emp, run);
    expect(m.name).toBe("Jonnel Magno");
    expect(m.periodLabel).toBe("Sept. 16-30, 2026");
    expect(m.dateLabel).toBe("30-Sep-26");
    expect(m.employeeNo).toBe("VCDC-016");
    expect(m.designation).toBe("Site Engineer");
    expect(m.reference).toBe("2026-009");
    expect(m.approvedBy).toBe("Jacob Villamor");
    expect(m.totalEarnings).toBe(11365.61);
    expect(m.netPay).toBe(10491.03);
  });

  it("prices overtime at the payroll premium and keeps the earnings total as the register's gross", () => {
    const m = buildPayslip(entry({ otHours: 2, hourlyRate: 100, gross: 1000 }), emp, run);
    expect(m.earnings.otPay).toBe(250); // 2 hrs x 100 x 1.25
    expect(m.earnings.total).toBe(1000);
    expect(buildPayslip(entry({ otHours: 0 }), emp, run).earnings.otPay).toBe(0);
  });

  it("totals the deductions it lists", () => {
    const m = buildPayslip(entry({ sss: 400, philhealth: 200, pagibig: 100, meals: 50, cashAdvance: 250 }), emp, run);
    expect(m.totalDeductions).toBe(1000);
    expect(m.deductions.map((d) => d.label)).toEqual(["SSS", "PHILHEALTH", "PAG-IBIG", "Meals", "Cash advance"]);
  });

  it("only shows the optional deduction lines when there is an amount", () => {
    const m = buildPayslip(entry({ meals: 0, cashAdvance: 120 }), emp, run);
    const byLabel = Object.fromEntries(m.deductions.map((d) => [d.label, d]));
    expect(byLabel["SSS"].showWhenZero).toBe(true);
    expect(byLabel["Meals"].showWhenZero).toBe(false);
    expect(byLabel["Cash advance"].amount).toBe(120);
  });

  it("leaves the employee ID blank rather than inventing one", () => {
    expect(buildPayslip(entry(), { ...emp, employeeNo: null }, run).employeeNo).toBe("");
  });

  it("falls back to the department when no position is set", () => {
    expect(buildPayslip(entry(), { employeeNo: null, position: null, department: "DRIVER" }, run).designation).toBe("Driver");
    expect(buildPayslip(entry(), { employeeNo: null, position: "  ", department: "ENGINEER" }, run).designation).toBe("Engineer");
    expect(buildPayslip(entry(), { employeeNo: null, position: null, department: null }, run).designation).toBe("");
  });

  it("copes with an older run that has no meals / cash advance / reference", () => {
    const old = entry({ meals: undefined as unknown as number, cashAdvance: undefined as unknown as number, slipRef: undefined });
    const m = buildPayslip(old, emp, { ...run, approvedByName: null });
    expect(m.totalDeductions).toBe(874.58);
    expect(m.reference).toBe("");
    expect(m.approvedBy).toBe("");
  });
});

describe("payslip PDF", () => {
  const slip = (name: string, ref = "2026-001") => buildPayslip(entry({ name, slipRef: ref }), emp, run);

  it("puts three payslips side by side on each landscape A4 sheet", async () => {
    const pdf = await PDFDocument.load(await buildPayslipsPdf([slip("A"), slip("B"), slip("C"), slip("D")], "a4-three-up", "t"));
    expect(pdf.getPageCount()).toBe(2); // 3 on the first sheet, 1 on the second
    for (const p of pdf.getPages()) {
      expect(Math.round(p.getWidth())).toBe(842); // A4 landscape
      expect(Math.round(p.getHeight())).toBe(595);
    }
  });

  it("fits exactly three per sheet for a multiple of three", async () => {
    expect((await PDFDocument.load(await buildPayslipsPdf([slip("A"), slip("B"), slip("C")], "a4-three-up", "t"))).getPageCount()).toBe(1);
    expect((await PDFDocument.load(await buildPayslipsPdf(["A", "B", "C", "D", "E", "F"].map((n) => slip(n)), "a4-three-up", "t"))).getPageCount()).toBe(2);
    expect((await PDFDocument.load(await buildPayslipsPdf(["A", "B"].map((n) => slip(n)), "a4-three-up", "t"))).getPageCount()).toBe(1);
  });

  it("draws each payslip 3 1/8 in x 5 1/2 in", () => {
    expect(SLIP_W).toBe(225);
    expect(SLIP_H).toBe(396);
  });

  it("makes a single copy on a page just bigger than one slip", async () => {
    const pdf = await PDFDocument.load(await buildPayslipsPdf([slip("A")], "single", "t"));
    expect(pdf.getPageCount()).toBe(1);
    expect(Math.round(pdf.getPage(0).getWidth())).toBe(241); // 225 + 2 x 8 margin
    expect(Math.round(pdf.getPage(0).getHeight())).toBe(412); // 396 + 2 x 8 margin
  });

  it("does not choke on awkward names, long text or no slips", async () => {
    const odd = ["Dela Peña, Ñoño", "Juan ₱ Cruz 😀 “quoted” – dash", "X".repeat(200), ""];
    const pdf = await PDFDocument.load(await buildPayslipsPdf(odd.map((n) => slip(n)), "a4-three-up", "t"));
    expect(pdf.getPageCount()).toBe(2);
    expect((await PDFDocument.load(await buildPayslipsPdf([], "a4-three-up", "t"))).getPageCount()).toBe(1);
  });
});
