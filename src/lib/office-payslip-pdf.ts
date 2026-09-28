import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

/**
 * Renders Office/Driver payroll as individual cut-slips — two per row,
 * stacked down the page — matching the company's own payslip form (Name /
 * Department / Total Pay, a Contri/Meals/C-A deduction breakdown, Net Pay).
 * "Contri" combines SSS + PhilHealth + Pag-IBIG into the one line the paper
 * form uses; Meals and Cash Advance are their own editable lines (set on the
 * payroll register before approval).
 */

export interface PayslipData {
  name: string;
  department: string; // shown as the slip's "Projects" line, e.g. "OFFICE" or "DRIVER"
  gross: number;
  contri: number; // sss + philhealth + pagibig
  meals: number;
  cashAdvance: number;
  net: number;
}

export interface PayslipSheetData {
  title: string; // e.g. "Office Payroll — Sep 15 to Sep 21, 2026"
  slips: PayslipData[];
}

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 30;
const GUTTER = 16;
const COL_W = (PAGE_W - MARGIN * 2 - GUTTER) / 2;
const SLIP_H = 132;
const SLIPS_PER_PAGE = Math.floor((PAGE_H - MARGIN * 2 - 20) / SLIP_H);

function sanitize(text: string): string {
  return text
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/₱/g, "P")
    .replace(/[^\x00-\xff]/g, "?");
}

function php(n: number): string {
  return `P${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function drawSlip(page: PDFPage, x: number, topY: number, font: PDFFont, bold: PDFFont, slip: PayslipData) {
  const ink = rgb(0.09, 0.1, 0.11);
  const rule = rgb(0.6, 0.63, 0.62);
  const w = COL_W;
  const h = SLIP_H - 10;

  page.drawRectangle({ x, y: topY - h, width: w, height: h, borderColor: rule, borderWidth: 0.75 });

  let y = topY - 14;
  page.drawText("Name:", { x: x + 6, y, size: 8, font: bold, color: ink });
  page.drawText(sanitize(slip.name), { x: x + 40, y, size: 8, font, color: ink });
  y -= 14;

  page.drawText(sanitize(slip.department), { x: x + 6, y, size: 7.5, font, color: ink });
  page.drawText("Total Pay", { x: x + w * 0.42, y, size: 7.5, font: bold, color: ink });
  page.drawText(php(slip.gross), { x: x + w * 0.68, y, size: 7.5, font, color: ink });
  y -= 12;

  page.drawText("Deductions:", { x: x + 6, y, size: 7, font: bold, color: rule });
  y -= 11;
  page.drawText("Contri", { x: x + 10, y, size: 7.5, font, color: ink });
  page.drawText(php(slip.contri), { x: x + w * 0.68, y, size: 7.5, font, color: ink });
  y -= 11;
  page.drawText("Meals", { x: x + 10, y, size: 7.5, font, color: ink });
  page.drawText(php(slip.meals), { x: x + w * 0.68, y, size: 7.5, font, color: ink });
  y -= 11;
  page.drawText("C/A", { x: x + 10, y, size: 7.5, font, color: ink });
  page.drawText(php(slip.cashAdvance), { x: x + w * 0.68, y, size: 7.5, font, color: ink });
  y -= 14;

  page.drawLine({ start: { x: x + 6, y }, end: { x: x + w - 6, y }, thickness: 0.5, color: rule });
  y -= 12;
  page.drawText("NET PAY", { x: x + 6, y, size: 8.5, font: bold, color: ink });
  page.drawText("PHP", { x: x + w * 0.42, y, size: 8, font, color: ink });
  page.drawText(php(slip.net), { x: x + w * 0.6, y, size: 9, font: bold, color: ink });
}

export async function buildOfficePayslipsPdf(data: PayslipSheetData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.09, 0.1, 0.11);

  const slips = data.slips.map((s) => ({ ...s, name: sanitize(s.name), department: sanitize(s.department) }));
  const pageCount = Math.max(1, Math.ceil(slips.length / (SLIPS_PER_PAGE * 2)));

  for (let p = 0; p < pageCount; p++) {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    let y = PAGE_H - MARGIN;
    page.drawText(sanitize(data.title), { x: MARGIN, y, size: 11, font: bold, color: ink });
    y -= 20;

    for (let row = 0; row < SLIPS_PER_PAGE; row++) {
      const leftIndex = p * SLIPS_PER_PAGE * 2 + row * 2;
      const rightIndex = leftIndex + 1;
      if (leftIndex >= slips.length) break;
      drawSlip(page, MARGIN, y, font, bold, slips[leftIndex]);
      if (rightIndex < slips.length) {
        drawSlip(page, MARGIN + COL_W + GUTTER, y, font, bold, slips[rightIndex]);
      }
      y -= SLIP_H;
    }
  }

  return doc.save();
}
