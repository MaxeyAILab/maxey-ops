import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { COMPANY } from "@/lib/company";
import { PAYSLIP_LOGO_PNG_BASE64 } from "@/lib/payslip-logo";
import { slipDays, slipMoney, type PayslipModel } from "@/lib/payslip";

/**
 * Draws payslips in the company's own form. Each payslip is portrait, 3 1/8 in x 5 1/2 in:
 * logo and company name, "PAYSLIP — for the period of…", name / date, employee ID / designation, an EARNINGS
 * table, a DEDUCTIONS table, approved-by, net pay and reference number.
 *
 *  - "a4-three-up": A4 LANDSCAPE with three payslips side by side (a dashed cut line between them) — the Owner's
 *    print copy. A last sheet may hold one or two.
 *  - "single": one payslip on a page just bigger than the slip — an employee's own copy. Printed at actual size
 *    it is the same 3 1/8 x 5 1/2 in as the Owner's copy.
 */

export type PayslipLayout = "a4-three-up" | "single";

const PT = 72; // points per inch
export const SLIP_W = 3.125 * PT; // 225
export const SLIP_H = 5.5 * PT; // 396
const A4_LANDSCAPE: [number, number] = [841.89, 595.28];
const SINGLE_MARGIN = 8;

const INK = rgb(0.07, 0.08, 0.09);
const RULE = rgb(0.25, 0.27, 0.27);
const SOFT = rgb(0.4, 0.42, 0.42);
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
  while (s > 5 && font.widthOfTextAtSize(text, s) > maxW) s -= 0.25;
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

const hline = (page: PDFPage, x1: number, x2: number, y: number, t = 0.5) => page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: t, color: RULE });
const vline = (page: PDFPage, x: number, y1: number, y2: number, t = 0.5) => page.drawLine({ start: { x, y: y1 }, end: { x, y: y2 }, thickness: t, color: RULE });

/** A labelled value on an underline, as in "Name: ____ Jonnel Magno ____". */
function field(page: PDFPage, f: Fonts, label: string, value: string, x: number, y: number, endX: number, size = 6.5) {
  draw(page, label, x, y, size, f.regular);
  const startX = x + f.regular.widthOfTextAtSize(label, size) + 3;
  hline(page, startX, endX, y - 2, 0.4);
  if (value) {
    const t = fit(safe(value), f.regular, size + 0.5, endX - startX - 3);
    draw(page, t.text, startX + 2, y, t.size, f.regular);
  }
}

function drawSlip(page: PDFPage, x: number, top: number, slip: PayslipModel, f: Fonts, logo: PDFImage) {
  const W = SLIP_W;
  const left = x;
  const right = x + W;
  const il = left + 5;
  const ir = right - 5;
  const tw = ir - il;

  page.drawRectangle({ x: left, y: top - SLIP_H, width: W, height: SLIP_H, borderColor: INK, borderWidth: 0.8 });

  // ---- header: logo + company
  const logoSize = 38;
  page.drawImage(logo, { x: left + 6, y: top - 8 - logoSize, width: logoSize, height: logoSize });
  const cx = left + 48 + (W - 52) / 2;
  const n1 = fit(COMPANY.nameLines[0], f.bold, 8.2, W - 54);
  draw(page, n1.text, cx, top - 16, n1.size, f.bold, "center");
  draw(page, COMPANY.nameLines[1], cx, top - 26, n1.size, f.bold, "center");
  draw(page, COMPANY.addressLines[0], cx, top - 37, 6.3, f.regular, "center");
  draw(page, COMPANY.addressLines[1], cx, top - 45, 6.3, f.regular, "center");
  hline(page, left, right, top - 54);

  // ---- PAYSLIP row
  draw(page, "P A Y S L I P", il, top - 66, 7.5, f.bold);
  const forText = fit(`For the period of ${slip.periodLabel}`, f.bold, 6.8, tw - 62);
  draw(page, forText.text, il + 60, top - 66, forText.size, f.bold);
  hline(page, left, right, top - 71);
  if (slip.projectName) {
    const t = fit(safe(`Project: ${slip.projectName}`), f.regular, 6, tw);
    draw(page, t.text, ir, top - 79, t.size, f.regular, "right", SOFT);
  }

  // ---- name / date, employee ID / designation
  let y = top - 90;
  field(page, f, "Name:", slip.name, il, y, left + W * 0.62);
  field(page, f, "Date:", slip.dateLabel, left + W * 0.64, y, ir);
  y -= 13;
  field(page, f, "Employee ID:", slip.employeeNo, il, y, left + W * 0.45);
  field(page, f, "Designation:", slip.designation, left + W * 0.47, y, ir);
  hline(page, left, right, y - 6);

  // ---- earnings
  y -= 18;
  draw(page, "EARNINGS:", il, y, 8, f.bold);
  const cols = [tw * 0.24, tw * 0.17, tw * 0.27, tw * 0.32];
  const xs = [il];
  for (const c of cols) xs.push(xs[xs.length - 1] + c);
  const earnTop = y - 4;
  const headH = 24;
  page.drawRectangle({ x: il, y: earnTop - headH, width: tw, height: headH, color: SHADE });
  draw(page, "HOURS/DAY", (xs[0] + xs[1]) / 2, earnTop - 14, 6.2, f.bold, "center");
  draw(page, "RATE", (xs[1] + xs[2]) / 2, earnTop - 14, 6.2, f.bold, "center");
  draw(page, "O.T. PAY/", (xs[2] + xs[3]) / 2, earnTop - 10, 6.2, f.bold, "center");
  draw(page, "HOLIDAY PAY", (xs[2] + xs[3]) / 2, earnTop - 18, 6.2, f.bold, "center");
  draw(page, "TOTAL", (xs[3] + xs[4]) / 2, earnTop - 15, 7.5, f.bold, "center");
  y = earnTop - headH;

  const e = slip.earnings;
  const dataH = 28;
  draw(page, `${e.regularHours} hrs`, xs[0] + 3, y - 11, 6.8, f.regular);
  draw(page, `${slipDays(e.days)} day${e.days === 1 ? "" : "s"}`, xs[0] + 3, y - 20, 6, f.regular, "left", SOFT);
  draw(page, slipMoney(e.hourlyRate), xs[2] - 3, y - 11, 6.8, f.regular, "right");
  draw(page, "per hr", xs[2] - 3, y - 20, 6, f.regular, "right", SOFT);
  if (e.otHours > 0) {
    draw(page, slipMoney(e.otPay), xs[3] - 3, y - 11, 6.8, f.regular, "right");
    draw(page, `${e.otHours} hrs`, xs[3] - 3, y - 20, 6, f.regular, "right", SOFT);
  }
  draw(page, slipMoney(e.total), xs[4] - 3, y - 11, 6.8, f.regular, "right");
  y -= dataH;
  const blankH = 13;
  for (let i = 0; i < 2; i++) {
    hline(page, il, ir, y);
    y -= blankH;
  }
  hline(page, il, ir, y);
  const totH = 15;
  draw(page, "TOTAL EARNINGS", xs[3] - 4, y - 10, 6.8, f.bold, "right");
  draw(page, slipMoney(slip.totalEarnings), xs[4] - 3, y - 10, 7.2, f.bold, "right");
  y -= totH;
  hline(page, il, ir, y);
  page.drawRectangle({ x: il, y, width: tw, height: earnTop - y, borderColor: RULE, borderWidth: 0.5 });
  for (let i = 1; i < 4; i++) vline(page, xs[i], earnTop, y + totH);
  vline(page, xs[3], y + totH, y);
  hline(page, il, ir, earnTop - headH);

  // ---- deductions
  y -= 15;
  draw(page, "DEDUCTIONS:", il, y, 8, f.bold);
  const dcols = [tw * 0.4, tw * 0.28, tw * 0.32];
  const dx = [il];
  for (const c of dcols) dx.push(dx[dx.length - 1] + c);
  const dedTop = y - 4;
  const dHead = 17;
  page.drawRectangle({ x: il, y: dedTop - dHead, width: tw, height: dHead, color: SHADE });
  draw(page, "DETAILS", (dx[0] + dx[1]) / 2, dedTop - 11, 6.2, f.bold, "center");
  draw(page, "PERIOD", (dx[1] + dx[2]) / 2, dedTop - 11, 6.2, f.bold, "center");
  draw(page, "TOTAL", (dx[2] + dx[3]) / 2, dedTop - 12, 7.5, f.bold, "center");
  y = dedTop - dHead;
  const dRow = 14;
  // The form's first line, "Absent" (days and dates), is left for the team to note by hand; pay here is by hours worked,
  // so an absence is already reflected in the hours. Then SSS, PhilHealth, Pag-IBIG and the "others" lines.
  const rows: { label: string; amount: number | null }[] = [{ label: "Absent", amount: null }, ...slip.deductions.map((d) => ({ label: d.label, amount: d.amount > 0 || d.showWhenZero ? d.amount : null }))];
  for (const r of rows) {
    draw(page, r.label, dx[0] + 3, y - 10, 6.8, f.regular);
    if (r.amount != null) draw(page, slipMoney(r.amount), dx[3] - 3, y - 10, 6.8, f.regular, "right");
    hline(page, il, ir, y - dRow);
    y -= dRow;
  }
  draw(page, "TOTAL DEDUCTIONS", dx[2] - 4, y - 10, 6.8, f.bold, "right");
  draw(page, slipMoney(slip.totalDeductions), dx[3] - 3, y - 10, 7.2, f.bold, "right");
  y -= 15;
  hline(page, il, ir, y);
  page.drawRectangle({ x: il, y, width: tw, height: dedTop - y, borderColor: RULE, borderWidth: 0.5 });
  vline(page, dx[1], dedTop, y + 15);
  vline(page, dx[2], dedTop, y);
  hline(page, il, ir, dedTop - dHead);

  // ---- footer: approved by, net pay, reference
  y -= 17;
  draw(page, "Approved By:", il, y, 6.5, f.regular);
  const sigStart = il + 40;
  const sigEnd = left + W * 0.5;
  hline(page, sigStart, sigEnd, y - 2, 0.4);
  if (slip.approvedBy) {
    const t = fit(safe(slip.approvedBy), f.regular, 6.8, sigEnd - sigStart - 3);
    draw(page, t.text, sigStart + 2, y, t.size, f.regular);
  }
  draw(page, "NET PAY:", left + W * 0.52, y, 7.5, f.bold);
  draw(page, "PHP", left + W * 0.52 + 36, y, 6.5, f.regular);
  hline(page, left + W * 0.52 + 52, ir, y - 2, 0.4);
  draw(page, slipMoney(slip.netPay), ir - 2, y, 8, f.bold, "right");

  y -= 15;
  draw(page, "Reference No.:", left + W * 0.5, y, 5.6, f.regular, "left", SOFT);
  if (slip.reference) draw(page, slip.reference, left + W * 0.5 + 42, y, 6, f.regular, "left", SOFT);
}

export async function buildPayslipsPdf(slips: PayslipModel[], layout: PayslipLayout, title: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(safe(title));
  doc.setProducer("Maxey Ops");
  const f: Fonts = { regular: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold) };
  const logo = await doc.embedPng(Buffer.from(PAYSLIP_LOGO_PNG_BASE64, "base64"));

  if (layout === "single") {
    for (const slip of slips) {
      const page = doc.addPage([SLIP_W + SINGLE_MARGIN * 2, SLIP_H + SINGLE_MARGIN * 2]);
      drawSlip(page, SINGLE_MARGIN, SLIP_H + SINGLE_MARGIN, slip, f, logo);
    }
    if (slips.length === 0) doc.addPage([SLIP_W + SINGLE_MARGIN * 2, SLIP_H + SINGLE_MARGIN * 2]);
  } else {
    const [pw, ph] = A4_LANDSCAPE;
    const gap = (pw - SLIP_W * 3) / 4; // equal space at both edges and between the slips
    const top = ph - (ph - SLIP_H) / 2; // vertically centred
    for (let i = 0; i < slips.length; i += 3) {
      const page = doc.addPage(A4_LANDSCAPE);
      for (let k = 0; k < 3 && slips[i + k]; k++) {
        drawSlip(page, gap + k * (SLIP_W + gap), top, slips[i + k], f, logo);
      }
      // dashed cut lines in the gaps between the three slips
      for (const k of [1, 2]) {
        const cutX = gap + k * (SLIP_W + gap) - gap / 2;
        page.drawLine({ start: { x: cutX, y: 18 }, end: { x: cutX, y: ph - 18 }, thickness: 0.4, color: SOFT, dashArray: [3, 3] });
      }
    }
    if (slips.length === 0) doc.addPage(A4_LANDSCAPE);
  }
  return doc.save();
}
