import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { VCDC_HEADER_JPG_BASE64 } from "./vcdc-header-image";

/**
 * Renders the company's paper "Requisition for Tools and Materials" slip as
 * a real PDF, populated from a live Requisition record. Matches the paper
 * form's own layout: two half-page slips per sheet (so a printed sheet can
 * be cut in two), each with the letterhead, PROJECT/DATE/LOCATION header,
 * a 12-row S/N-QTY-UNIT-DESCRIPTION-REMARKS table, and signature lines.
 * Requisitions with more than 12 items overflow into the second slip, and
 * beyond 24 items spill onto additional sheets, two slips at a time.
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

const PAGE_W = 612; // US Letter
const PAGE_H = 792;
const HALF_H = PAGE_H / 2; // each slip is half a Letter sheet
const SLIP_MARGIN = 16;
const ROWS_PER_SLIP = 12; // matches the paper form
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
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.09, 0.1, 0.11);
  const rule = rgb(0.6, 0.63, 0.62);
  const headerImage = await doc.embedJpg(Buffer.from(VCDC_HEADER_JPG_BASE64, "base64"));

  // Split items into 12-row pages worth of slips; pad to an even count so
  // slips always come in top/bottom pairs, matching the paper form (a
  // trailing pair member with no items renders as a blank spare copy).
  const chunks: RequisitionPdfItem[][] = [];
  for (let i = 0; i < data.items.length; i += ROWS_PER_SLIP) {
    chunks.push(data.items.slice(i, i + ROWS_PER_SLIP));
  }
  if (chunks.length === 0) chunks.push([]);
  if (chunks.length % 2 === 1) chunks.push([]);

  const totalSlips = chunks.length;

  function drawSlip(page: PDFPage, topY: number, items: RequisitionPdfItem[], startIndex: number, slipNo: number) {
    const left = SLIP_MARGIN;
    const contentW = PAGE_W - SLIP_MARGIN * 2;

    const headerImgW = contentW;
    const headerImgH = headerImgW * HEADER_IMG_ASPECT;
    page.drawImage(headerImage, {
      x: left,
      y: topY - headerImgH,
      width: headerImgW,
      height: headerImgH,
    });

    let y = topY - headerImgH - 12;

    drawCenteredText(page, "REQUISITION FOR TOOLS AND MATERIALS", PAGE_W / 2, y, 10, bold);
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
    page.drawText("DATE:", { x: left + contentW - 130, y, size: labelSize, font: bold, color: ink });
    page.drawText(data.date, { x: left + contentW - 130 + 28, y, size: labelSize, font, color: ink });
    y -= 11;

    const locationLabelW = bold.widthOfTextAtSize("LOCATION:", labelSize);
    page.drawText("LOCATION:", { x: left, y, size: labelSize, font: bold, color: ink });
    page.drawText(data.location, { x: left + locationLabelW + labelGap, y, size: labelSize, font, color: ink });
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
      // Plain hyphen, not an em dash — pdf-lib's built-in Helvetica doesn't
      // reliably encode U+2014, which rendered as a garbled glyph.
      const desc = item.spec ? `${item.name} - ${item.spec}` : item.name;
      page.drawText(desc.slice(0, 60), { x: cx + 3, y: ry, size: 7, font, color: ink });
      cx += cols[3].w;
      if (item.remarks) page.drawText(item.remarks.slice(0, 22), { x: cx + 3, y: ry, size: 6.5, font, color: ink });
    });

    // ---- Signatures ----
    let sigY = tableBottom - 20;
    const rightX = left + contentW / 2 + 8;
    const lineW = contentW / 2 - 16;

    page.drawText("REQUESTED BY:", { x: left, y: sigY, size: 8, font: bold, color: ink });
    page.drawText("APPROVED BY:", { x: rightX, y: sigY, size: 8, font: bold, color: ink });
    sigY -= 14;

    drawCenteredText(page, data.requestedBy, left + lineW / 2, sigY + 3, 8, font);
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
    // Dashed cut line between the two slips
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
