import ExcelJS from "exceljs";
import { COMPANY } from "@/lib/company";
import { COMPANY_LOGO_PNG_BASE64 } from "@/lib/company-logo-data";
import { DENOMINATIONS, cashBreakdown, dailyRateOf, sheetName, type PayrollFileKind } from "@/lib/payroll-export";
import type { PayrollEntry } from "@/lib/payroll";

/**
 * Builds the payroll Excel workbook of one pay period (see payroll-export.ts for which runs go in). Two sheets, to save paper
 * (owner's request 2026-11-20):
 *   1. Summary — its own page: one line per run, grand total, key figures, cash to prepare, sign-off;
 *   2. Payroll register — every run stacked on the same sheet, one compact block each (A. RDF Florida Farm, B. Drivers …), with a
 *      grand total and one sign-off at the end, so a week usually prints on a single page.
 * Line figures come from the approved runs (the record); deductions, net and every total are live Excel formulas.
 */

export interface WorkbookLine extends PayrollEntry {
  employeeNo: string | null;
  designation: string;
  /** office staff on a fixed salary: the monthly amount (shown instead of the daily rate) */
  monthlySalary: number | null;
}

export interface WorkbookRun {
  id: string;
  projectId: string | null;
  /** project name, or "Drivers" / "Office" … */
  name: string;
  location: string | null;
  status: string;
  approvedByName: string | null;
  approvedAt: Date | null;
  periodStart: Date;
  periodEnd: Date;
  /** overtime premium of this run: 1.25, drivers 1.0 */
  otMultiplier: number;
  lines: WorkbookLine[];
}

export interface WorkbookInput {
  kind: PayrollFileKind;
  periodStart: Date;
  periodEnd: Date;
  runs: WorkbookRun[];
  /** runs of the same period not approved yet — named on the summary so nobody thinks they were forgotten */
  waiting: { name: string; status: string }[];
  generatedBy: string;
  generatedAt: Date;
}

// ------------------------------------------------------------------------------------------------------------------ look
const BRAND = "FF8A1A28";
const BRAND_SOFT = "FFF4E9EB";
const BLOCK = "FFF3EEEF";
const LINE = "FFD9D2D3";
const INK = "FF2B2326";
const INK_SOFT = "FF6B6266";
const CASH = "FF0F766E";
const MONEY = '#,##0.00;[Red](#,##0.00);"-"';
const HOURS = '#,##0.00;[Red]-#,##0.00;"-"';
const DAYS = '#,##0.0#;[Red]-#,##0.0#;"-"';
const COUNT = '#,##0;[Red]-#,##0;"-"';
const FONT = "Calibri";

const thin = { style: "thin" as const, color: { argb: LINE } };
const boxed: Partial<ExcelJS.Borders> = { top: thin, left: thin, bottom: thin, right: thin };

const TZ = "Asia/Manila";
const dt = (d: Date, withTime: boolean) =>
  new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: withTime ? "short" : undefined, month: "short", day: "numeric", year: "numeric", ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}) }).format(d);
const dShort = (d: Date) => new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric" }).format(d);
export const periodText = (kind: PayrollFileKind, a: Date, b: Date) => (kind === "site" ? `${dt(a, true)}  →  ${dt(b, true)}` : `${dt(a, false)}  →  ${dt(b, false)}`);

const colLetter = (n: number): string => {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};
const ref = (sheet: string, cell: string) => `'${sheet.replace(/'/g, "''")}'!${cell}`;
const r2 = (n: number) => Math.round(n * 100) / 100;
const dedOf = (e: PayrollEntry) => r2(e.sss + e.philhealth + e.pagibig + e.meals + e.cashAdvance);

interface Col {
  key: string;
  header: string;
  width: number;
  fmt?: string;
  align?: "left" | "center" | "right";
}

function setWidths(ws: ExcelJS.Worksheet, cols: Col[]) {
  cols.forEach((c, i) => (ws.getColumn(i + 1).width = c.width));
}

/** Logo, address and the title lines at the top of a sheet (compact). Returns the next free row. */
function letterhead(ws: ExcelJS.Worksheet, logoId: number, lastCol: number, title: string, lines: string[]): number {
  ws.getRow(1).height = 20;
  ws.getRow(2).height = 17;
  ws.getRow(3).height = 17;
  ws.addImage(logoId, { tl: { col: 0.1, row: 0.1 }, ext: { width: 240, height: 53 } });
  // title on the right of the logo, same rows — saves the lines a title block would take
  const tcol = Math.max(5, Math.floor(lastCol / 2));
  const t = ws.getCell(1, tcol);
  t.value = title;
  t.font = { name: FONT, size: 15, bold: true, color: { argb: BRAND } };
  lines.slice(0, 2).forEach((l, i) => {
    const c = ws.getCell(2 + i, tcol);
    c.value = l;
    c.font = { name: FONT, size: 11, color: { argb: INK } };
  });
  const addr = ws.getCell(4, 1);
  addr.value = `${COMPANY.addressLines.join(" ")} · PCAB Registered`;
  addr.font = { name: FONT, size: 10, color: { argb: INK_SOFT } };
  let row = 4;
  for (const l of lines.slice(2)) {
    const c = ws.getCell(row, tcol);
    c.value = l;
    c.font = { name: FONT, size: 10, color: { argb: INK_SOFT } };
    row++;
  }
  for (let c = 1; c <= lastCol; c++) ws.getCell(row, c).border = { bottom: { style: "medium", color: { argb: BRAND } } };
  return row + 2;
}

function headerRow(ws: ExcelJS.Worksheet, row: number, cols: Col[], height = 32) {
  const r = ws.getRow(row);
  r.height = height;
  cols.forEach((c, i) => {
    const cell = r.getCell(i + 1);
    cell.value = c.header;
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND } };
    cell.alignment = { vertical: "middle", horizontal: c.align ?? (c.fmt ? "center" : "left"), wrapText: true };
    cell.border = boxed;
  });
}

function styleBody(ws: ExcelJS.Worksheet, row: number, cols: Col[], height = 17, size = 10.5) {
  const r = ws.getRow(row);
  r.height = height;
  cols.forEach((c, i) => {
    const cell = r.getCell(i + 1);
    cell.font = { name: FONT, size };
    if (c.fmt) cell.numFmt = c.fmt;
    cell.alignment = { vertical: "middle", horizontal: c.align ?? (c.fmt ? "right" : "left") };
    cell.border = boxed;
  });
}

function styleTotal(ws: ExcelJS.Worksheet, row: number, cols: Col[], grand = false) {
  const r = ws.getRow(row);
  r.height = grand ? 20 : 17;
  cols.forEach((c, i) => {
    const cell = r.getCell(i + 1);
    cell.font = { name: FONT, size: grand ? 11 : 10.5, bold: true, color: grand ? { argb: BRAND } : undefined };
    if (c.fmt) cell.numFmt = c.fmt;
    cell.alignment = { vertical: "middle", horizontal: c.align ?? (c.fmt ? "right" : "left") };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND_SOFT } };
    cell.border = grand
      ? { top: { style: "medium", color: { argb: BRAND } }, bottom: { style: "double", color: { argb: BRAND } }, left: thin, right: thin }
      : { top: { style: "thin", color: { argb: BRAND } }, bottom: { style: "thin", color: { argb: BRAND } }, left: thin, right: thin };
  });
}

/** Prepared / Checked / Approved / Released signature lines across the sheet. */
function signatures(ws: ExcelJS.Worksheet, row: number, lastCol: number, approver: string | null) {
  const boxes: [string, string][] = [
    ["Prepared by:", "Payroll"],
    ["Checked by:", "HR / Accounting"],
    ["Approved by:", approver ?? "Owner"],
    ["Cash released by:", "Finance / Cashier"],
  ];
  const span = Math.max(2, Math.floor(lastCol / boxes.length));
  boxes.forEach(([label, who], i) => {
    const from = 1 + i * span;
    const to = Math.min(lastCol, from + span - 2);
    const l = ws.getCell(row, from);
    l.value = label;
    l.font = { name: FONT, size: 10, color: { argb: INK_SOFT } };
    ws.mergeCells(row + 1, from, row + 1, to);
    for (let c = from; c <= to; c++) ws.getCell(row + 1, c).border = { bottom: { style: "thin", color: { argb: INK } } };
    ws.mergeCells(row + 2, from, row + 2, to);
    const n = ws.getCell(row + 2, from);
    n.value = who;
    n.font = { name: FONT, size: 10, bold: i === 2 && !!approver };
    n.alignment = { horizontal: "center" };
  });
  ws.getRow(row + 1).height = 24;
}

function pageSetup(ws: ExcelJS.Worksheet, footer: string, printTitles?: string) {
  ws.pageSetup = {
    ...ws.pageSetup,
    paperSize: 9,
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0, // as many pages tall as it needs — never squeezed onto one page
    horizontalCentered: true,
    margins: { left: 0.25, right: 0.25, top: 0.35, bottom: 0.45, header: 0.15, footer: 0.2 },
    ...(printTitles ? { printTitlesRow: printTitles } : {}),
  };
  ws.headerFooter.oddFooter = `&L&9${footer.replace(/&/g, "&&")}&R&9Page &P of &N`;
}

/**
 * How many points of sheet rows fit on one printed page: A4 landscape (842 × 595 pt) less the margins in pageSetup(), divided by the
 * shrink Excel applies to fit the columns to the page width (column width w ≈ 7w + 5 px of Calibri 11, 0.75 pt per px). A little
 * is kept spare so an estimate never runs past Excel's own break.
 */
function printablePageHeight(cols: Col[]): number {
  const sheetWidth = cols.reduce((s, c) => s + (c.width * 7 + 5) * 0.75, 0);
  const scale = Math.min(1, (842 - 2 * 18) / sheetWidth);
  return ((595 - 25.2 - 32.4) / scale) * 0.95;
}

// ------------------------------------------------------------------------------------------------- the payroll register
function registerCols(kind: PayrollFileKind): Col[] {
  return [
    { key: "no", header: "#", width: 4, align: "center" },
    { key: "id", header: "Emp. ID", width: 10.5 },
    { key: "name", header: "Name", width: 26.5 },
    { key: "designation", header: "Designation", width: 18.5 },
    ...(kind === "office" ? [{ key: "charged", header: "Charged to project", width: 17.5 } as Col] : []),
    kind === "office" ? { key: "daily", header: "Monthly salary", width: 11.5, fmt: MONEY } : { key: "daily", header: "Daily rate", width: 10, fmt: MONEY },
    { key: "rate", header: "Rate / hr", width: 9, fmt: MONEY },
    { key: "days", header: "Days", width: 7, fmt: DAYS },
    { key: "reg", header: "Reg hrs", width: 10, fmt: HOURS },
    { key: "ot", header: "OT hrs", width: 8, fmt: HOURS },
    { key: "gross", header: "Gross pay", width: 12.5, fmt: MONEY },
    { key: "sss", header: "SSS", width: 9, fmt: MONEY },
    { key: "ph", header: "Phil-Health", width: 9, fmt: MONEY },
    { key: "pagibig", header: "Pag-IBIG", width: 9, fmt: MONEY },
    { key: "meals", header: "Meals", width: 10, fmt: MONEY },
    { key: "ca", header: "Cash advance", width: 10.5, fmt: MONEY },
    { key: "ded", header: "Total deduct.", width: 11.5, fmt: MONEY },
    { key: "net", header: "NET PAY", width: 13, fmt: MONEY },
    { key: "slip", header: "Payslip no.", width: 10.5, align: "center" },
    { key: "sign", header: "Signature", width: 19.5 },
  ];
}

const SUM_KEYS = ["days", "reg", "ot", "gross", "sss", "ph", "pagibig", "meals", "ca", "ded", "net"] as const;

/** Where one run's subtotal row is on the register, for the summary's formulas. */
interface BlockRef {
  run: WorkbookRun;
  letter: string;
  subtotalRow: number;
}

function addRegister(ws: ExcelJS.Worksheet, logoId: number, input: WorkbookInput): { blocks: BlockRef[]; col: Record<string, string> } {
  const cols = registerCols(input.kind);
  const idx = (k: string) => cols.findIndex((c) => c.key === k) + 1;
  const L = Object.fromEntries(cols.map((c, i) => [c.key, colLetter(i + 1)])) as Record<string, string>;
  setWidths(ws, cols);
  const nLines = input.runs.reduce((s, r) => s + r.lines.length, 0);
  let row = letterhead(ws, logoId, cols.length, input.kind === "site" ? "PAYROLL REGISTER — SITE CREWS & DRIVERS" : "PAYROLL REGISTER — OFFICE", [
    `Pay period:  ${periodText(input.kind, input.periodStart, input.periodEnd)}`,
    `${input.runs.length} run${input.runs.length === 1 ? "" : "s"} · ${nLines} worker line${nLines === 1 ? "" : "s"} · totals on the Summary sheet`,
  ]);

  // who appears in more than one run this period (flagged beside the name)
  const runsOf = new Map<string, string[]>();
  for (const r of input.runs) for (const e of r.lines) runsOf.set(e.userId, [...(runsOf.get(e.userId) ?? []), r.name]);

  // Page breaks: a run's title + column header never sit alone at the foot of a page, and the grand total stays with the signatures.
  const usable = printablePageHeight(cols);
  let pageTop = 1;
  const usedOnPage = (upTo: number) => {
    let acc = 0;
    for (let i = pageTop; i < upTo; i++) {
      const h = ws.getRow(i).height || 15;
      acc += h;
      if (acc > usable) {
        pageTop = i; // Excel breaks here on its own
        acc = h;
      }
    }
    return acc;
  };
  const keepTogether = (need: number) => {
    if (row > 1 && usedOnPage(row) + need > usable) {
      ws.getRow(row - 1).addPageBreak();
      pageTop = row;
    }
  };

  const blocks: BlockRef[] = [];
  input.runs.forEach((run, bi) => {
    keepTogether(21 + 32 + Math.min(run.lines.length, 3) * 17 + (run.lines.length <= 3 ? 17 : 0));
    const letter = String.fromCharCode(65 + (bi % 26));
    // block title: "A.  RDF Florida Farm · location · Paid · approved by … on …"
    const project = !!run.projectId;
    const bits = [
      run.location || (project ? null : "Office · Malapit, San Isidro, N.E."),
      run.status === "PAID" ? "Paid" : "Approved, not paid yet",
      run.approvedByName ? `approved by ${run.approvedByName}${run.approvedAt ? ` · ${dt(run.approvedAt, false)}` : ""}` : null,
      input.runs.some((r) => r.periodStart.getTime() !== run.periodStart.getTime() || r.periodEnd.getTime() !== run.periodEnd.getTime()) ? `${dShort(run.periodStart)} – ${dShort(run.periodEnd)}` : null,
    ].filter(Boolean);
    ws.mergeCells(row, 1, row, cols.length);
    const t = ws.getCell(row, 1);
    t.value = { richText: [{ text: `${letter}.  ${project ? "PROJECT" : "GROUP"}:  ${run.name}`, font: { name: FONT, size: 11.5, bold: true, color: { argb: BRAND } } }, { text: `     ${bits.join("  ·  ")}`, font: { name: FONT, size: 10, color: { argb: INK_SOFT } } }] };
    t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLOCK } };
    t.alignment = { vertical: "middle" };
    ws.getRow(row).height = 21;
    row++;
    headerRow(ws, row, cols);
    row++;

    const first = row;
    const lines = [...run.lines].sort((a, b) => a.name.localeCompare(b.name));
    lines.forEach((e, i) => {
      const r = ws.getRow(row);
      const set = (k: string, v: ExcelJS.CellValue) => (r.getCell(idx(k)).value = v);
      const others = (runsOf.get(e.userId) ?? []).filter((n) => n !== run.name);
      set("no", i + 1);
      set("id", e.employeeNo ?? "");
      set("name", `${e.name}${e.manual ? " (added by hand)" : ""}${others.length ? `  ⚠ also in ${others.join(", ")}` : ""}`);
      set("designation", e.designation);
      if (input.kind === "office") set("charged", e.chargedProject?.projectName ?? "");
      set("daily", input.kind === "office" ? (e.monthlySalary ?? "") : dailyRateOf(e.hourlyRate));
      set("rate", e.hourlyRate);
      set("days", e.daysWorked);
      set("reg", e.regularHours);
      set("ot", e.otHours);
      set("gross", e.gross);
      set("sss", e.sss);
      set("ph", e.philhealth);
      set("pagibig", e.pagibig);
      set("meals", e.meals);
      set("ca", e.cashAdvance);
      set("ded", { formula: `SUM(${L.sss}${row}:${L.ca}${row})`, result: dedOf(e) });
      const net = r2(e.gross - dedOf(e));
      // the run's own net is the record; it always equals gross − deductions, and the formula keeps the sheet auditable
      set("net", Math.abs(net - e.net) < 0.011 ? { formula: `${L.gross}${row}-${L.ded}${row}`, result: net } : e.net);
      set("slip", e.slipRef ?? "");
      styleBody(ws, row, cols);
      r.getCell(idx("net")).font = { name: FONT, size: 11, bold: true };
      if (others.length) r.getCell(idx("name")).font = { name: FONT, size: 10.5, color: { argb: "FFB45309" } };
      row++;
    });
    const last = Math.max(first, row - 1);
    if (lines.length === 0) row++;
    const tr = ws.getRow(row);
    tr.getCell(idx("name")).value = `Subtotal — ${run.name} (${lines.length})`;
    const sums: Record<string, number> = {
      days: lines.reduce((s, e) => s + e.daysWorked, 0),
      reg: lines.reduce((s, e) => s + e.regularHours, 0),
      ot: lines.reduce((s, e) => s + e.otHours, 0),
      gross: lines.reduce((s, e) => s + e.gross, 0),
      sss: lines.reduce((s, e) => s + e.sss, 0),
      ph: lines.reduce((s, e) => s + e.philhealth, 0),
      pagibig: lines.reduce((s, e) => s + e.pagibig, 0),
      meals: lines.reduce((s, e) => s + e.meals, 0),
      ca: lines.reduce((s, e) => s + e.cashAdvance, 0),
      ded: lines.reduce((s, e) => s + dedOf(e), 0),
      net: lines.reduce((s, e) => s + e.net, 0),
    };
    for (const k of SUM_KEYS) tr.getCell(idx(k)).value = { formula: `SUM(${L[k]}${first}:${L[k]}${last})`, result: r2(sums[k]) };
    styleTotal(ws, row, cols);
    blocks.push({ run, letter, subtotalRow: row });
    ws.getRow(row + 1).height = 10;
    row += 2; // a thin gap between runs
  });

  // grand total of every run (kept on the same page as the note and the signatures)
  keepTogether(20 + 15 + 15 + 15 + 24 + 15);
  const gt = ws.getRow(row);
  gt.getCell(idx("name")).value = `GRAND TOTAL — ${nLines} line${nLines === 1 ? "" : "s"}`;
  for (const k of SUM_KEYS) gt.getCell(idx(k)).value = { formula: blocks.map((b) => `${L[k]}${b.subtotalRow}`).join("+") || "0" };
  styleTotal(ws, row, cols, true);

  const note = ws.getCell(row + 1, 1);
  note.value =
    input.kind === "site"
      ? "Project gross pay is posted to that project's committed cost. Overtime: site crews × 1.25, drivers × 1.0. ⚠ = the person is also paid in another run this period."
      : "Office overtime × 1.25. A line with 'Charged to project' is posted to that project's committed cost, not to the office.";
  note.font = { name: FONT, size: 10, italic: true, color: { argb: INK_SOFT } };

  const approver = [...new Set(input.runs.map((r) => r.approvedByName).filter(Boolean))].join(" / ") || null;
  signatures(ws, row + 3, cols.length, approver);
  ws.views = [{ state: "normal", showGridLines: false }];
  pageSetup(ws, `${COMPANY.nameLines.join(" ")} · Payroll register · ${periodText(input.kind, input.periodStart, input.periodEnd)}`);
  return { blocks, col: L };
}

// ----------------------------------------------------------------------------------------------------------------- summary
function fillSummary(ws: ExcelJS.Worksheet, logoId: number, input: WorkbookInput, regSheet: string, reg: { blocks: BlockRef[]; col: Record<string, string> }) {
  const cols: Col[] = [
    { key: "no", header: "", width: 4.5, align: "center" },
    { key: "group", header: input.kind === "site" ? "Project / group" : "Payroll group", width: 26 },
    { key: "location", header: "Location", width: 34.5 },
    { key: "status", header: "Status", width: 11.5, align: "center" },
    { key: "approved", header: "Approved by", width: 20.5 },
    { key: "workers", header: "Workers", width: 9, fmt: COUNT },
    { key: "days", header: "Days", width: 8, fmt: DAYS },
    { key: "reg", header: "Reg hrs", width: 9, fmt: HOURS },
    { key: "ot", header: "OT hrs", width: 8.5, fmt: HOURS },
    { key: "gross", header: "Gross pay", width: 14.5, fmt: MONEY },
    { key: "sss", header: "SSS", width: 11, fmt: MONEY },
    { key: "ph", header: "PhilHealth", width: 11, fmt: MONEY },
    { key: "pagibig", header: "Pag-IBIG", width: 11, fmt: MONEY },
    { key: "meals", header: "Meals", width: 11, fmt: MONEY },
    { key: "ca", header: "Cash advance", width: 12, fmt: MONEY },
    { key: "ded", header: "Total deductions", width: 14, fmt: MONEY },
    { key: "net", header: "NET PAY (cash out)", width: 16, fmt: MONEY },
  ];
  setWidths(ws, cols);
  const S = Object.fromEntries(cols.map((c, i) => [c.key, colLetter(i + 1)])) as Record<string, string>;
  const idx = (k: string) => cols.findIndex((x) => x.key === k) + 1;
  const all = input.runs.flatMap((r) => r.lines);
  const waitingLine = input.waiting.length
    ? `Not in this file yet (not approved):  ${input.waiting.map((w) => `${w.name} (${w.status === "REVIEW" ? "in review" : "draft"})`).join(", ")}`
    : "Every run of this period is approved — nothing is left out.";
  const head = letterhead(ws, logoId, cols.length, input.kind === "site" ? "PAYROLL SUMMARY — SITE CREWS & DRIVERS" : "PAYROLL SUMMARY — OFFICE", [
    `Pay period:  ${periodText(input.kind, input.periodStart, input.periodEnd)}${input.kind === "site" ? "  (weekly)" : "  (semi-monthly)"}`,
    `${input.runs.length} approved run${input.runs.length === 1 ? "" : "s"} · ${all.length} pay line${all.length === 1 ? "" : "s"} · details on the Payroll register sheet`,
    waitingLine,
    `Downloaded from Maxey Ops by ${input.generatedBy} on ${dt(input.generatedAt, true)}`,
  ]);
  if (input.waiting.length) ws.getCell(4, Math.max(5, Math.floor(cols.length / 2))).font = { name: FONT, size: 10, bold: true, color: { argb: "FFB45309" } };
  headerRow(ws, head, cols);

  reg.blocks.forEach((b, i) => {
    const row = head + 1 + i;
    const r = ws.getRow(row);
    const c = (k: string) => r.getCell(idx(k));
    const link = (k: string) => (c(k).value = { formula: ref(regSheet, `${reg.col[k]}${b.subtotalRow}`) });
    c("no").value = `${b.letter}.`;
    c("group").value = b.run.name;
    c("location").value = b.run.location ?? (b.run.projectId ? "—" : "Office");
    c("status").value = b.run.status === "PAID" ? "Paid" : "Approved";
    c("approved").value = b.run.approvedByName ?? "";
    c("workers").value = b.run.lines.length;
    for (const k of SUM_KEYS) link(k);
    styleBody(ws, row, cols, 19, 10.5);
    c("group").font = { name: FONT, size: 10.5, bold: true, color: { argb: BRAND } };
    c("net").font = { name: FONT, size: 11, bold: true };
  });
  const first = head + 1;
  const last = head + reg.blocks.length;
  const total = last + 1;
  const tr = ws.getRow(total);
  tr.getCell(2).value = "GRAND TOTAL";
  for (const k of ["workers", ...SUM_KEYS]) tr.getCell(idx(k)).value = { formula: `SUM(${S[k]}${first}:${S[k]}${last})` };
  styleTotal(ws, total, cols, true);

  // ---- key figures (left)
  let row = total + 2;
  const kTitle = ws.getCell(row, 2);
  kTitle.value = "KEY FIGURES";
  kTitle.font = { name: FONT, size: 11, bold: true, color: { argb: BRAND } };
  const gross = (rs: WorkbookRun[]) => r2(rs.reduce((s, r) => s + r.lines.reduce((t, e) => t + e.gross, 0), 0));
  const projectGross = gross(input.runs.filter((r) => r.projectId));
  const deptGross = gross(input.runs.filter((r) => !r.projectId));
  const charged = r2(all.filter((e) => e.chargedProject).reduce((s, e) => s + e.gross, 0));
  const owes = all.filter((e) => e.net < 0);
  const runsOf = new Map<string, Set<string>>();
  for (const r of input.runs) for (const e of r.lines) runsOf.set(e.userId, (runsOf.get(e.userId) ?? new Set()).add(r.name));
  const twice = [...new Set(all.filter((e) => (runsOf.get(e.userId)?.size ?? 0) > 1).map((e) => e.name))];
  const figures: [string, ExcelJS.CellValue, string?, boolean?][] =
    input.kind === "site"
      ? [
          ["Labor cost posted to projects (gross)", projectGross, "goes into each project's committed cost"],
          ["Drivers (gross)", deptGross, "operations expense"],
          ["Cash advances recovered", { formula: `${S.ca}${total}` }],
          ["Total cash to prepare (net)", { formula: `${S.net}${total}` }],
        ]
      : [
          ["Office payroll (gross)", r2(deptGross - charged), "operations expense"],
          ["Charged to projects (gross)", charged, "project engineers paid by the office run"],
          ["Cash advances recovered", { formula: `${S.ca}${total}` }],
          ["Total to pay out (net)", { formula: `${S.net}${total}` }],
        ];
  if (twice.length) figures.push(["Paid in more than one run", twice.length, `check: ${twice.join(", ")}`, true]);
  if (owes.length) figures.push(["Cash advance more than the pay", owes.length, owes.map((e) => e.name).join(", "), true]);
  for (const [label, value, hint, isCount] of figures) {
    row++;
    ws.mergeCells(row, 2, row, 3);
    ws.getCell(row, 2).value = label;
    ws.getCell(row, 2).font = { name: FONT, size: 10.5 };
    ws.getCell(row, 2).border = { bottom: thin };
    const v = ws.getCell(row, 4);
    v.value = value;
    v.numFmt = isCount ? COUNT : MONEY;
    v.font = { name: FONT, size: 11, bold: true, color: isCount ? { argb: "FFB45309" } : undefined };
    v.alignment = { horizontal: "right" };
    v.border = { bottom: thin };
    if (hint) {
      ws.getCell(row, 5).value = hint;
      ws.getCell(row, 5).font = { name: FONT, size: 10, italic: true, color: { argb: INK_SOFT } };
    }
  }

  // ---- cash to prepare (right): bills and coins for every pay envelope, added up
  const pieces = DENOMINATIONS.map(() => 0);
  let centavos = 0;
  for (const e of all) {
    const cb = cashBreakdown(e.net);
    cb.pieces.forEach((p, i) => (pieces[i] += p));
    centavos = r2(centavos + cb.centavos);
  }
  const c0 = cols.length - 4;
  let crow = total + 2;
  const cTitle = ws.getCell(crow, c0);
  cTitle.value = "CASH TO PREPARE";
  cTitle.font = { name: FONT, size: 11, bold: true, color: { argb: CASH } };
  ws.getCell(crow, c0 + 2).value = "(for every envelope)";
  ws.getCell(crow, c0 + 2).font = { name: FONT, size: 10, italic: true, color: { argb: INK_SOFT } };
  crow++;
  ["Bill / coin", "Pieces", "Amount"].forEach((h, i) => {
    const c = ws.getCell(crow, c0 + i * 2);
    c.value = h;
    c.font = { name: FONT, size: 10, bold: true, color: { argb: INK_SOFT } };
  });
  const firstCash = crow + 1;
  DENOMINATIONS.forEach((d, i) => {
    crow++;
    ws.getCell(crow, c0).value = `₱${d.toLocaleString("en-US")}`;
    const p = ws.getCell(crow, c0 + 2);
    p.value = pieces[i];
    p.numFmt = COUNT;
    const a = ws.getCell(crow, c0 + 4);
    a.value = { formula: `${colLetter(c0 + 2)}${crow}*${d}`, result: pieces[i] * d };
    a.numFmt = MONEY;
    [ws.getCell(crow, c0), p, a].forEach((c) => {
      c.font = { name: FONT, size: 10.5 };
      c.border = { bottom: thin };
    });
  });
  crow++;
  ws.getCell(crow, c0).value = "Centavos";
  ws.getCell(crow, c0).font = { name: FONT, size: 10.5 };
  const cents = ws.getCell(crow, c0 + 4);
  cents.value = centavos;
  cents.numFmt = MONEY;
  crow++;
  ws.getCell(crow, c0).value = "TOTAL CASH";
  const tc = ws.getCell(crow, c0 + 4);
  tc.value = { formula: `SUM(${colLetter(c0 + 4)}${firstCash}:${colLetter(c0 + 4)}${crow - 1})` };
  tc.numFmt = MONEY;
  [ws.getCell(crow, c0), tc].forEach((c) => (c.font = { name: FONT, size: 11, bold: true, color: { argb: CASH } }));
  tc.border = { top: { style: "thin", color: { argb: CASH } }, bottom: { style: "double", color: { argb: CASH } } };

  const approver = [...new Set(input.runs.map((r) => r.approvedByName).filter(Boolean))].join(" / ") || null;
  signatures(ws, Math.max(row, crow) + 2, cols.length, approver);
  ws.views = [{ state: "normal", showGridLines: false }];
  pageSetup(ws, `${COMPANY.nameLines.join(" ")} · Payroll summary · ${periodText(input.kind, input.periodStart, input.periodEnd)}`);
}

// ------------------------------------------------------------------------------------------------------------------- build
export async function buildPayrollWorkbook(input: WorkbookInput): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = `Maxey Ops — ${input.generatedBy}`;
  wb.created = input.generatedAt;
  wb.calcProperties.fullCalcOnLoad = true;
  const logoId = wb.addImage({ buffer: Buffer.from(COMPANY_LOGO_PNG_BASE64, "base64") as unknown as ExcelJS.Buffer, extension: "png" });

  const taken = new Set<string>();
  const summary = wb.addWorksheet(sheetName("Summary", taken), { properties: { tabColor: { argb: "FFEA580C" } } });
  const regName = sheetName("Payroll register", taken);
  const register = wb.addWorksheet(regName, { properties: { tabColor: { argb: BRAND } } });
  const reg = addRegister(register, logoId, input);
  fillSummary(summary, logoId, input, regName, reg);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
