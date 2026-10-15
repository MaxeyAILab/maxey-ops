import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { COMPANY } from "@/lib/company";
import { PAYSLIP_LOGO_PNG_BASE64 } from "@/lib/payslip-logo";
import { slipMoney, type PayslipModel } from "@/lib/payslip";

/**
 * Draws payslips in the company's own form: logo and company name, "PAYSLIP — for the period of…", name / date,
 * employee ID / designation, an EARNINGS table, a DEDUCTIONS table, approved-by, net pay and reference number.
 *
 *  - "a4-two-up": A4 portrait with two payslips per sheet (one above the other, a dashed cut line between) —
 *    the Owner's print copy. A last odd slip sits alone on its sheet.
 *  - "single": one payslip on a page the size of half an A4 (A5 landscape) — an employee's own copy; printed on
 *    A4 at 100% it takes the same space as one half of the Owner's sheet.
 */

export type PayslipLayout = "a4-two-up" | "single";

const A4: [number, number] = [595.28, 841.89];
const HALF_A4: [number, number] = [595.28, 420.94]; // A5 landscape
const SLIP_W = 535;
const SLIP_H = 384;

const INK = rgb(0.07, 0.08, 0.09);
const RULE = rgb(0.25, 0.27, 0.27);
const SOFT = rgb(0.45, 0.47, 0.47);
const SHADE = rgb(0.85, 0.85, 0.85);

/** Helvetica can't print characters outside Latin-1 (e.g. the peso sign); keep names and text safe. */
function safe(text: string): string {
  return text
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/₱/g, "P")
    .replace(/…/g, "...")
    .replace(/[^\x20-\xff]/g, "?");
}

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
}

/** Shrink a line to fit a width, then trim it with "..." if it still doesn't. */
function fit(text: string, font: PDFFont, size: number, maxW: number): { text: string; size: number } {
  let s = size;
  while (s > 6 && font.widthOfTextAtSize(text, s) > maxW) s -= 0.5;
  if (font.widthOfTextAtSize(text, s) <= maxW) return { text, size: s };
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}...`, s) > maxW) t = t.slice(0, -1);
  return { text: `${t}...`, size: s };
}

function draw(page: PDFPage, text: string, x: number, y: number, size: number, font: PDFFont, align: "left" | "right" | "center" = "left", color = INK) {
  const w = font.widthOfTextAtSize(text, size);
  const px = align === "left" ? x : align === "right" ? x - w : x - w / 2;
  page.drawText(text, { x: px, y, size, font, color });
}

function hline(page: PDFPage, x1: number, x2: number, y: number, thickness = 0.6, color = RULE) {
  page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness, color });
}

function vline(page: PDFPage, x: number, y1: number, y2: number, thickness = 0.6) {
  page.drawLine({ start: { x, y: y1 }, end: { x, y: y2 }, thickness, color: RULE });
}

/** A labelled value on an underline, as in "Name: ____ Jonnel Magno ____". */
function field(page: PDFPage, f: Fonts, label: string, value: string, x: number, y: number, endX: number) {
  draw(page, label, x, y, 8, f.regular);
  const startX = x + f.regular.widthOfTextAtSize(label, 8) + 5;
  hline(page, startX, endX, y - 2.5, 0.5);
  if (value) {
    const t = fit(safe(value), f.regular, 8.5, endX - startX - 6);
    draw(page, t.text, startX + 4, y, t.size, f.regular);
  }
}

function drawSlip(page: PDFPage, x: number, top: number, slip: PayslipModel, f: Fonts, logo: PDFImage) {
  const W = SLIP_W;
  const left = x;
  const right = x + W;
  const inner = { l: left + 8, r: right - 8 };
  const tableW = inner.r - inner.l;

  page.drawRectangle({ x: left, y: top - SLIP_H, width: W, height: SLIP_H, borderColor: INK, borderWidth: 0.9 });

  // ---- header: logo + company
  const logoSize = 46;
  page.drawImage(logo, { x: left + 14, y: top - 8 - logoSize, width: logoSize, height: logoSize });
  const cx = left + 66 + (W - 76) / 2;
  draw(page, COMPANY.nameLines[0], cx, top - 19, 11.5, f.bold, "center");
  draw(page, COMPANY.nameLines[1], cx, top - 32, 11.5, f.bold, "center");
  draw(page, COMPANY.addressLines[0], cx, top - 44, 8, f.regular, "center");
  draw(page, COMPANY.addressLines[1], cx, top - 54, 8, f.regular, "center");
  hline(page, left, right, top - 62);

  // ---- PAYSLIP row
  let y = top - 74;
  draw(page, "P A Y S L I P", inner.l, y, 10, f.bold);
  const forText = `For the period of ${slip.periodLabel}`;
  draw(page, forText, inner.l + 82, y, 9, f.bold);
  if (slip.projectName) {
    const t = fit(safe(`Project: ${slip.projectName}`), f.regular, 8, 150);
    draw(page, t.text, inner.r, y, t.size, f.regular, "right", SOFT);
  }
  hline(page, left, right, top - 80);

  // ---- name / date, employee ID / designation
  y = top - 95;
  const mid = left + W * 0.56;
  field(page, f, "Name:", slip.name, inner.l, y, mid - 12);
  field(page, f, "Date:", slip.dateLabel, mid, y, inner.r);
  y -= 16;
  field(page, f, "Employee ID:", slip.employeeNo, inner.l, y, mid - 12);
  field(page, f, "Designation:", slip.designation, mid, y, inner.r);
  hline(page, left, right, y - 8);

  // ---- earnings
  y -= 20;
  draw(page, "EARNINGS:", inner.l, y, 10, f.bold);
  y -= 6;
  const cols = [tableW * 0.29, tableW * 0.17, tableW * 0.29, tableW * 0.25];
  const xs = [inner.l];
  for (const c of cols) xs.push(xs[xs.length - 1] + c);

  const headH = 22;
  page.drawRectangle({ x: inner.l, y: y - headH, width: tableW, height: headH, color: SHADE });
  draw(page, "HOURS/DAY", (xs[0] + xs[1]) / 2, y - 14, 8, f.bold, "center");
  draw(page, "RATE", (xs[1] + xs[2]) / 2, y - 14, 8, f.bold, "center");
  draw(page, "O.T. PAY/", (xs[2] + xs[3]) / 2, y - 9, 8, f.bold, "center");
  draw(page, "HOLIDAY PAY", (xs[2] + xs[3]) / 2, y - 18, 8, f.bold, "center");
  draw(page, "TOTAL", (xs[3] + xs[4]) / 2, y - 14, 9, f.bold, "center");
  const earnTop = y;
  y -= headH;

  const rowH = 14;
  const e = slip.earnings;
  const hoursText = `${e.regularHours} hrs / ${e.daysWorked} day${e.daysWorked === 1 ? "" : "s"}`;
  draw(page, hoursText, xs[0] + 5, y - 10, 8.5, f.regular);
  draw(page, `${slipMoney(e.hourlyRate)} /hr`, xs[2] - 5, y - 10, 8.5, f.regular, "right");
  if (e.otHours > 0) draw(page, `${e.otHours} hrs  ${slipMoney(e.otPay)}`, xs[3] - 5, y - 10, 8.5, f.regular, "right");
  draw(page, slipMoney(e.total), xs[4] - 5, y - 10, 8.5, f.regular, "right");
  for (let i = 0; i < 3; i++) {
    hline(page, inner.l, inner.r, y - rowH * (i + 1));
  }
  y -= rowH * 3;
  // total earnings row
  draw(page, "TOTAL EARNINGS", xs[3] - 6, y - 10, 8.5, f.bold, "right");
  draw(page, slipMoney(slip.totalEarnings), xs[4] - 5, y - 10, 9, f.bold, "right");
  hline(page, inner.l, inner.r, y - rowH);
  y -= rowH;
  // grid
  page.drawRectangle({ x: inner.l, y, width: tableW, height: earnTop - y, borderColor: RULE, borderWidth: 0.6 });
  for (let i = 1; i < 4; i++) vline(page, xs[i], earnTop, y + rowH);
  vline(page, xs[3], y + rowH, y); // total row: label spans the first three columns

  // ---- deductions
  y -= 20;
  draw(page, "DEDUCTIONS:", inner.l, y, 10, f.bold);
  y -= 6;
  const dcols = [tableW * 0.4, tableW * 0.35, tableW * 0.25];
  const dx = [inner.l];
  for (const c of dcols) dx.push(dx[dx.length - 1] + c);
  const dHead = 16;
  const dedTop = y;
  page.drawRectangle({ x: inner.l, y: y - dHead, width: tableW, height: dHead, color: SHADE });
  draw(page, "DETAILS", (dx[0] + dx[1]) / 2, y - 11, 8, f.bold, "center");
  draw(page, "PERIOD", (dx[1] + dx[2]) / 2, y - 11, 8, f.bold, "center");
  draw(page, "TOTAL", (dx[2] + dx[3]) / 2, y - 11, 9, f.bold, "center");
  y -= dHead;
  const dRow = 13;
  for (const d of slip.deductions) {
    draw(page, d.label, dx[0] + 5, y - 9.5, 8.5, f.regular);
    if (d.amount > 0 || d.showWhenZero) draw(page, slipMoney(d.amount), dx[3] - 5, y - 9.5, 8.5, f.regular, "right");
    hline(page, inner.l, inner.r, y - dRow);
    y -= dRow;
  }
  draw(page, "TOTAL DEDUCTIONS", dx[2] - 6, y - 10, 8.5, f.bold, "right");
  draw(page, slipMoney(slip.totalDeductions), dx[3] - 5, y - 10, 9, f.bold, "right");
  hline(page, inner.l, inner.r, y - 14);
  y -= 14;
  page.drawRectangle({ x: inner.l, y, width: tableW, height: dedTop - y, borderColor: RULE, borderWidth: 0.6 });
  vline(page, dx[1], dedTop, y + 14);
  vline(page, dx[2], dedTop, y);

  // ---- footer: approved by, net pay, reference
  y -= 24;
  draw(page, "Approved By:", inner.l, y, 8, f.regular);
  const sigStart = inner.l + 58;
  hline(page, sigStart, sigStart + 150, y - 2.5, 0.5);
  if (slip.approvedBy) {
    const t = fit(safe(slip.approvedBy), f.regular, 8.5, 144);
    draw(page, t.text, sigStart + 4, y, t.size, f.regular);
  }
  draw(page, "NET PAY:", left + W * 0.56, y, 10, f.bold);
  draw(page, "PHP", left + W * 0.7, y, 9, f.regular);
  hline(page, left + W * 0.7 + 26, inner.r, y - 2.5, 0.5);
  draw(page, slipMoney(slip.netPay), inner.r - 2, y, 11, f.bold, "right");

  y -= 20;
  draw(page, "Reference No.:", left + W * 0.6, y, 7, f.regular, "left", SOFT);
  if (slip.reference) draw(page, slip.reference, left + W * 0.6 + 52, y, 7.5, f.regular, "left", SOFT);
}

export async function buildPayslipsPdf(slips: PayslipModel[], layout: PayslipLayout, title: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(safe(title));
  doc.setProducer("Maxey Ops");
  const f: Fonts = { regular: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold) };
  const logo = await doc.embedPng(Buffer.from(PAYSLIP_LOGO_PNG_BASE64, "base64"));

  if (layout === "single") {
    for (const slip of slips) {
      const page = doc.addPage(HALF_A4);
      drawSlip(page, (HALF_A4[0] - SLIP_W) / 2, HALF_A4[1] - (HALF_A4[1] - SLIP_H) / 2, slip, f, logo);
    }
  } else {
    const margin = (A4[1] - SLIP_H * 2) / 2 - 17; // leaves a 34 pt strip in the middle for the cut line
    for (let i = 0; i < slips.length; i += 2) {
      const page = doc.addPage(A4);
      const x = (A4[0] - SLIP_W) / 2;
      drawSlip(page, x, A4[1] - margin, slips[i], f, logo);
      if (slips[i + 1]) drawSlip(page, x, A4[1] - margin - SLIP_H - 34, slips[i + 1], f, logo);
      // dashed cut line between the two slips
      const cutY = A4[1] - margin - SLIP_H - 17;
      page.drawLine({ start: { x: 24, y: cutY }, end: { x: A4[0] - 24, y: cutY }, thickness: 0.5, color: SOFT, dashArray: [4, 3] });
      draw(page, "cut here", A4[0] / 2, cutY + 3, 5.5, f.regular, "center", SOFT);
    }
    if (slips.length === 0) doc.addPage(A4);
  }
  return doc.save();
}
