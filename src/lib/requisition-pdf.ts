import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { VCDC_HEADER_JPG_BASE64 } from "./vcdc-header-image";

/**
 * Renders the company's paper "Requisition for Tools and Materials" slip as
 * a real PDF, populated from a live Requisition record — same layout as the
 * printed form (PROJECT/DATE/LOCATION header, S/N–QTY–UNIT–DESCRIPTION–
 * REMARKS table, Requested By / Approved By signature lines), so a printed
 * copy is a drop-in replacement for the paper one.
 */

export interface RequisitionPdfItem {
  qty: number;
  unit: string;
  name: string;
  spec: string | null;
  remarks: string | null;
}

export interface RequisitionPdfData {
  projectLabel: string;
  location: string;
  date: string;
  items: RequisitionPdfItem[];
  requestedBy: string;
  approvedBy: string | null;
  approvedDate: string | null;
}

const PAGE_W = 612; // US Letter, matching the source form
const PAGE_H = 792;
const MARGIN = 48;
const MIN_ROWS = 12; // the paper form has 12 blank lines
const HEADER_IMG_ASPECT = 400 / 2048; // height / width of the source banner

function fmtQty(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

/** pdf-lib's built-in Helvetica only reliably encodes WinAnsi (roughly
 * Windows-1252) — free-text fields (item names, remarks, notes) can contain
 * anything a user typed, so normalize common "smart" punctuation and the
 * peso sign to ASCII, then drop whatever's left outside that range rather
 * than let it render as a garbled glyph or throw. */
function sanitize(text: string): string {
  return text
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/₱/g, "P")
    .replace(/[^\x00-\xff]/g, "?");
}

function drawCenteredText(
  page: PDFPage,
  text: string,
  centerX: number,
  y: number,
  size: number,
  font: PDFFont
) {
  const w = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: centerX - w / 2, y, size, font });
}

export async function buildRequisitionPdf(rawData: RequisitionPdfData): Promise<Uint8Array> {
  const data: RequisitionPdfData = {
    projectLabel: sanitize(rawData.projectLabel),
    location: sanitize(rawData.location),
    date: rawData.date,
    requestedBy: sanitize(rawData.requestedBy),
    approvedBy: rawData.approvedBy != null ? sanitize(rawData.approvedBy) : null,
    approvedDate: rawData.approvedDate,
    items: rawData.items.map((i) => ({
      qty: i.qty,
      unit: sanitize(i.unit),
      name: sanitize(i.name),
      spec: i.spec != null ? sanitize(i.spec) : null,
      remarks: i.remarks != null ? sanitize(i.remarks) : null,
    })),
  };

  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.09, 0.1, 0.11);
  const rule = rgb(0.6, 0.63, 0.62);

  const headerImage = await doc.embedJpg(Buffer.from(VCDC_HEADER_JPG_BASE64, "base64"));
  const headerImgW = PAGE_W - MARGIN * 2;
  const headerImgH = headerImgW * HEADER_IMG_ASPECT;
  page.drawImage(headerImage, {
    x: MARGIN,
    y: PAGE_H - MARGIN - headerImgH,
    width: headerImgW,
    height: headerImgH,
  });

  let y = PAGE_H - MARGIN - headerImgH - 22;

  drawCenteredText(page, "REQUISITION FOR TOOLS AND MATERIALS", PAGE_W / 2, y, 14, bold);
  y -= 30;

  // Value x-offset derived from each label's own width so a longer label
  // (LOCATION:) doesn't crowd its value the way a fixed offset would.
  const labelGap = 8;
  const projectLabelW = bold.widthOfTextAtSize("PROJECT:", 10);
  page.drawText("PROJECT:", { x: MARGIN, y, size: 10, font: bold, color: ink });
  page.drawText(data.projectLabel, { x: MARGIN + projectLabelW + labelGap, y, size: 10, font, color: ink });
  page.drawText("DATE:", { x: 420, y, size: 10, font: bold, color: ink });
  page.drawText(data.date, { x: 420 + 38, y, size: 10, font, color: ink });
  y -= 18;

  const locationLabelW = bold.widthOfTextAtSize("LOCATION:", 10);
  page.drawText("LOCATION:", { x: MARGIN, y, size: 10, font: bold, color: ink });
  page.drawText(data.location, { x: MARGIN + locationLabelW + labelGap, y, size: 10, font, color: ink });
  y -= 22;

  // ---- Table ----
  const tableX = MARGIN;
  const tableW = PAGE_W - MARGIN * 2;
  const colW = { sn: 30, qty: 55, unit: 55, remarks: 100 };
  const descW = tableW - colW.sn - colW.qty - colW.unit - colW.remarks;
  const cols = [
    { key: "sn", label: "S/N", w: colW.sn },
    { key: "qty", label: "QTY.", w: colW.qty },
    { key: "unit", label: "UNIT", w: colW.unit },
    { key: "desc", label: "DESCRIPTION", w: descW },
    { key: "remarks", label: "REMARKS", w: colW.remarks },
  ];
  const headerH = 22;
  const rowH = 20;
  const rowCount = Math.max(data.items.length, MIN_ROWS);
  const tableTop = y;
  const tableBottom = tableTop - headerH - rowCount * rowH;

  // Outer + column dividers
  let cx = tableX;
  for (const col of cols) {
    page.drawLine({ start: { x: cx, y: tableTop }, end: { x: cx, y: tableBottom }, thickness: 1, color: rule });
    cx += col.w;
  }
  page.drawLine({ start: { x: cx, y: tableTop }, end: { x: cx, y: tableBottom }, thickness: 1, color: rule });

  // Top border, header underline, bottom border
  page.drawLine({ start: { x: tableX, y: tableTop }, end: { x: tableX + tableW, y: tableTop }, thickness: 1, color: rule });
  page.drawLine({
    start: { x: tableX, y: tableTop - headerH },
    end: { x: tableX + tableW, y: tableTop - headerH },
    thickness: 1,
    color: rule,
  });
  page.drawLine({ start: { x: tableX, y: tableBottom }, end: { x: tableX + tableW, y: tableBottom }, thickness: 1, color: rule });

  // Row dividers
  for (let i = 1; i < rowCount; i++) {
    const ry = tableTop - headerH - i * rowH;
    page.drawLine({ start: { x: tableX, y: ry }, end: { x: tableX + tableW, y: ry }, thickness: 0.5, color: rule });
  }

  // Header labels
  cx = tableX;
  for (const col of cols) {
    drawCenteredText(page, col.label, cx + col.w / 2, tableTop - headerH + 7, 9, bold);
    cx += col.w;
  }

  // Rows
  data.items.forEach((item, i) => {
    const ry = tableTop - headerH - i * rowH - rowH + 6;
    cx = tableX;
    drawCenteredText(page, String(i + 1), cx + cols[0].w / 2, ry, 9, font);
    cx += cols[0].w;
    drawCenteredText(page, fmtQty(item.qty), cx + cols[1].w / 2, ry, 9, font);
    cx += cols[1].w;
    drawCenteredText(page, item.unit, cx + cols[2].w / 2, ry, 9, font);
    cx += cols[2].w;
    // Plain hyphen, not an em dash — pdf-lib's built-in Helvetica doesn't
    // reliably encode U+2014, which rendered as a garbled glyph.
    const desc = item.spec ? `${item.name} - ${item.spec}` : item.name;
    page.drawText(desc.slice(0, 70), { x: cx + 4, y: ry, size: 9, font, color: ink });
    cx += cols[3].w;
    if (item.remarks) page.drawText(item.remarks.slice(0, 30), { x: cx + 4, y: ry, size: 8, font, color: ink });
  });

  // ---- Signatures ----
  let sigY = tableBottom - 46;
  const leftX = MARGIN;
  const rightX = MARGIN + tableW / 2 + 10;
  const lineW = tableW / 2 - 20;

  page.drawText("REQUESTED BY:", { x: leftX, y: sigY, size: 10, font: bold, color: ink });
  page.drawText("APPROVED BY:", { x: rightX, y: sigY, size: 10, font: bold, color: ink });
  sigY -= 26;

  drawCenteredText(page, data.requestedBy, leftX + lineW / 2, sigY + 4, 10, font);
  drawCenteredText(page, data.approvedBy ?? "", rightX + lineW / 2, sigY + 4, 10, font);
  page.drawLine({ start: { x: leftX, y: sigY }, end: { x: leftX + lineW, y: sigY }, thickness: 1, color: ink });
  page.drawLine({ start: { x: rightX, y: sigY }, end: { x: rightX + lineW, y: sigY }, thickness: 1, color: ink });
  sigY -= 12;
  drawCenteredText(page, "Name and Signature", leftX + lineW / 2, sigY, 8, font);
  drawCenteredText(page, "Name and Signature", rightX + lineW / 2, sigY, 8, font);
  if (data.approvedDate) {
    sigY -= 12;
    drawCenteredText(page, data.approvedDate, rightX + lineW / 2, sigY, 7, font);
  }

  return doc.save();
}
