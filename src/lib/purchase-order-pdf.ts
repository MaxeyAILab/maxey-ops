import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { VCDC_HEADER_JPG_BASE64 } from "./vcdc-header-image";

/**
 * Renders the company's paper "Purchase Order" slip as a real PDF, matching
 * the paper form's own layout: two half-page slips per sheet (so a printed
 * sheet can be cut in two), each with the letterhead, PROJECT/SUPPLIER and
 * LOCATION/DATE header, a 12-row S/N-QTY-UNIT-DESCRIPTION-REMARKS table, and
 * Prepared By / Approved By signature lines. Structurally the same approach
 * as requisition-pdf.ts, adapted for the PO form's own header/field layout.
 */

export interface PurchaseOrderPdfItem {
  qty: number;
  unit: string;
  name: string;
  remarks: string | null;
}

export interface PurchaseOrderPdfData {
  projectLabel: string;
  location: string;
  supplier: string;
  date: string;
  items: PurchaseOrderPdfItem[];
  preparedBy: string;
  approvedBy: string | null;
  approvedDate: string | null;
}

const PAGE_W = 612; // US Letter
const PAGE_H = 792;
const HALF_H = PAGE_H / 2;
const SLIP_MARGIN = 16;
const ROWS_PER_SLIP = 12;
const HEADER_IMG_ASPECT = 400 / 2048;

function fmtQty(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

/** See requisition-pdf.ts — same WinAnsi-only limitation in pdf-lib's built-in fonts. */
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

export async function buildPurchaseOrderPdf(rawData: PurchaseOrderPdfData): Promise<Uint8Array> {
  const data: PurchaseOrderPdfData = {
    projectLabel: sanitize(rawData.projectLabel),
    location: sanitize(rawData.location),
    supplier: sanitize(rawData.supplier),
    date: rawData.date,
    preparedBy: sanitize(rawData.preparedBy),
    approvedBy: rawData.approvedBy != null ? sanitize(rawData.approvedBy) : null,
    approvedDate: rawData.approvedDate,
    items: rawData.items.map((i) => ({
      qty: i.qty,
      unit: sanitize(i.unit),
      name: sanitize(i.name),
      remarks: i.remarks != null ? sanitize(i.remarks) : null,
    })),
  };

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.09, 0.1, 0.11);
  const rule = rgb(0.6, 0.63, 0.62);
  const headerImage = await doc.embedJpg(Buffer.from(VCDC_HEADER_JPG_BASE64, "base64"));

  const chunks: PurchaseOrderPdfItem[][] = [];
  for (let i = 0; i < data.items.length; i += ROWS_PER_SLIP) {
    chunks.push(data.items.slice(i, i + ROWS_PER_SLIP));
  }
  if (chunks.length === 0) chunks.push([]);
  if (chunks.length % 2 === 1) chunks.push([]);

  const totalSlips = chunks.length;

  function drawSlip(page: PDFPage, topY: number, items: PurchaseOrderPdfItem[], startIndex: number, slipNo: number) {
    const left = SLIP_MARGIN;
    const contentW = PAGE_W - SLIP_MARGIN * 2;
    const rightColX = left + 330;

    const headerImgW = contentW;
    const headerImgH = headerImgW * HEADER_IMG_ASPECT;
    page.drawImage(headerImage, {
      x: left,
      y: topY - headerImgH,
      width: headerImgW,
      height: headerImgH,
    });

    let y = topY - headerImgH - 12;

    drawCenteredText(page, "PURCHASE ORDER", PAGE_W / 2, y, 10, bold);
    if (totalSlips > 2) {
      page.drawText(`Sheet ${slipNo} of ${totalSlips}`, {
        x: left + contentW - 55,
        y,
        size: 6.5,
        font,
        color: rule,
      });
    }
    y -= 15;

    const labelGap = 5;
    const labelSize = 8;

    const projectLabelW = bold.widthOfTextAtSize("PROJECT:", labelSize);
    page.drawText("PROJECT:", { x: left, y, size: labelSize, font: bold, color: ink });
    page.drawText(data.projectLabel, { x: left + projectLabelW + labelGap, y, size: labelSize, font, color: ink });
    const supplierLabelW = bold.widthOfTextAtSize("SUPPLIER:", labelSize);
    page.drawText("SUPPLIER:", { x: rightColX, y, size: labelSize, font: bold, color: ink });
    page.drawText(data.supplier, { x: rightColX + supplierLabelW + labelGap, y, size: labelSize, font, color: ink });
    y -= 11;

    const locationLabelW = bold.widthOfTextAtSize("LOCATION:", labelSize);
    page.drawText("LOCATION:", { x: left, y, size: labelSize, font: bold, color: ink });
    page.drawText(data.location, { x: left + locationLabelW + labelGap, y, size: labelSize, font, color: ink });
    const dateLabelW = bold.widthOfTextAtSize("DATE:", labelSize);
    page.drawText("DATE:", { x: rightColX, y, size: labelSize, font: bold, color: ink });
    page.drawText(data.date, { x: rightColX + dateLabelW + labelGap, y, size: labelSize, font, color: ink });
    y -= 13;

    // ---- Table ----
    const colW = { sn: 22, qty: 40, unit: 42, remarks: 78 };
    const descW = contentW - colW.sn - colW.qty - colW.unit - colW.remarks;
    const cols = [
      { label: "S/N", w: colW.sn },
      { label: "QTY.", w: colW.qty },
      { label: "UNIT", w: colW.unit },
      { label: "DESCRIPTION", w: descW },
      { label: "REMARKS", w: colW.remarks },
    ];
    const headerH = 12;
    const rowH = 13.5;
    const tableTop = y;
    const tableBottom = tableTop - headerH - ROWS_PER_SLIP * rowH;

    let cx = left;
    for (const col of cols) {
      page.drawLine({ start: { x: cx, y: tableTop }, end: { x: cx, y: tableBottom }, thickness: 1, color: rule });
      cx += col.w;
    }
    page.drawLine({ start: { x: cx, y: tableTop }, end: { x: cx, y: tableBottom }, thickness: 1, color: rule });

    page.drawLine({ start: { x: left, y: tableTop }, end: { x: left + contentW, y: tableTop }, thickness: 1, color: rule });
    page.drawLine({
      start: { x: left, y: tableTop - headerH },
      end: { x: left + contentW, y: tableTop - headerH },
      thickness: 1,
      color: rule,
    });
    page.drawLine({ start: { x: left, y: tableBottom }, end: { x: left + contentW, y: tableBottom }, thickness: 1, color: rule });

    for (let i = 1; i < ROWS_PER_SLIP; i++) {
      const ry = tableTop - headerH - i * rowH;
      page.drawLine({ start: { x: left, y: ry }, end: { x: left + contentW, y: ry }, thickness: 0.5, color: rule });
    }

    cx = left;
    for (const col of cols) {
      drawCenteredText(page, col.label, cx + col.w / 2, tableTop - headerH + 3.5, 6.5, bold);
      cx += col.w;
    }

    items.forEach((item, i) => {
      const ry = tableTop - headerH - i * rowH - rowH + 4;
      cx = left;
      drawCenteredText(page, String(startIndex + i + 1), cx + cols[0].w / 2, ry, 7, font);
      cx += cols[0].w;
      drawCenteredText(page, fmtQty(item.qty), cx + cols[1].w / 2, ry, 7, font);
      cx += cols[1].w;
      drawCenteredText(page, item.unit, cx + cols[2].w / 2, ry, 7, font);
      cx += cols[2].w;
      page.drawText(item.name.slice(0, 60), { x: cx + 3, y: ry, size: 7, font, color: ink });
      cx += cols[3].w;
      if (item.remarks) page.drawText(item.remarks.slice(0, 22), { x: cx + 3, y: ry, size: 6.5, font, color: ink });
    });

    // ---- Signatures ----
    let sigY = tableBottom - 20;
    const rightX = left + contentW / 2 + 8;
    const lineW = contentW / 2 - 16;

    page.drawText("PREPARED BY:", { x: left, y: sigY, size: 8, font: bold, color: ink });
    page.drawText("APPROVED BY:", { x: rightX, y: sigY, size: 8, font: bold, color: ink });
    sigY -= 14;

    drawCenteredText(page, data.preparedBy, left + lineW / 2, sigY + 3, 8, font);
    drawCenteredText(page, data.approvedBy ?? "", rightX + lineW / 2, sigY + 3, 8, font);
    page.drawLine({ start: { x: left, y: sigY }, end: { x: left + lineW, y: sigY }, thickness: 1, color: ink });
    page.drawLine({ start: { x: rightX, y: sigY }, end: { x: rightX + lineW, y: sigY }, thickness: 1, color: ink });
    sigY -= 9;
    drawCenteredText(page, "Name and Signature", left + lineW / 2, sigY, 6.5, font);
    drawCenteredText(page, "Name and Signature", rightX + lineW / 2, sigY, 6.5, font);
    if (data.approvedDate) {
      sigY -= 9;
      drawCenteredText(page, data.approvedDate, rightX + lineW / 2, sigY, 6, font);
    }
  }

  for (let p = 0; p * 2 < chunks.length; p++) {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    const topChunk = chunks[p * 2];
    const bottomChunk = chunks[p * 2 + 1];

    drawSlip(page, PAGE_H, topChunk, p * 2 * ROWS_PER_SLIP, p * 2 + 1);
    page.drawLine({
      start: { x: 0, y: HALF_H },
      end: { x: PAGE_W, y: HALF_H },
      thickness: 0.75,
      color: rgb(0.75, 0.75, 0.75),
      dashArray: [4, 3],
    });
    drawSlip(page, HALF_H, bottomChunk, (p * 2 + 1) * ROWS_PER_SLIP, p * 2 + 2);
  }

  return doc.save();
}
