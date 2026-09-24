import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { VCDC_HEADER_JPG_BASE64 } from "./vcdc-header-image";

/**
 * Renders a Daily Construction Report as a real, multi-page PDF matching the
 * standard DCR paper format: letterhead, header fields, ten numbered
 * sections (word-wrapped, paginating as needed), and Prepared/Checked/Noted
 * signature lines. Unlike the fixed-slip PO/Delivery/Requisition forms, a
 * DCR's narrative sections are variable-length, so this uses a small
 * line-wrapping/page-flowing cursor instead of a fixed row grid.
 */

export interface DailyReportPdfData {
  projectLabel: string;
  location: string;
  reportDate: string;
  weather: string;
  workingHours: string;
  preparedBy: string;
  reportNo: string;
  workProgress: string;
  deliveries: { material: string; qty: string; supplier: string; condition: string }[];
  manpower: { role: string; count: number }[];
  equipment: string;
  siteEvents: string;
  issues: string;
  safety: string;
  weatherNotes: string;
  plannedNextDay: string;
  overallProgress: string;
}

const PAGE_W = 612; // US Letter
const PAGE_H = 792;
const MARGIN = 42;
const CONTENT_W = PAGE_W - MARGIN * 2;
const HEADER_IMG_ASPECT = 400 / 2048;

/** See purchase-order-pdf.ts — pdf-lib's built-in fonts only render WinAnsi. */
function sanitize(text: string): string {
  return text
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/₱/g, "P")
    .replace(/[^\x00-\xff]/g, "?");
}

function wrapLines(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    if (para.trim() === "") {
      out.push("");
      continue;
    }
    let current = "";
    for (const word of para.split(/\s+/)) {
      const test = current ? `${current} ${word}` : word;
      if (current && font.widthOfTextAtSize(test, size) > maxWidth) {
        out.push(current);
        current = word;
      } else {
        current = test;
      }
    }
    if (current) out.push(current);
  }
  return out;
}

class ReportCursor {
  doc: PDFDocument;
  font: PDFFont;
  bold: PDFFont;
  ink = rgb(0.09, 0.1, 0.11);
  rule = rgb(0.6, 0.63, 0.62);
  page!: PDFPage;
  y = 0;
  pageNum = 0;

  constructor(doc: PDFDocument, font: PDFFont, bold: PDFFont) {
    this.doc = doc;
    this.font = font;
    this.bold = bold;
  }

  addPage() {
    this.page = this.doc.addPage([PAGE_W, PAGE_H]);
    this.y = PAGE_H - MARGIN;
    this.pageNum += 1;
  }

  ensureSpace(h: number) {
    if (this.y - h < MARGIN + 14) this.addPage();
  }

  gap(h: number) {
    this.y -= h;
  }

  text(str: string, opts: { size?: number; font?: PDFFont; indent?: number } = {}) {
    const size = opts.size ?? 9;
    const font = opts.font ?? this.font;
    this.ensureSpace(size + 3);
    this.page.drawText(str, { x: MARGIN + (opts.indent ?? 0), y: this.y, size, font, color: this.ink });
    this.y -= size + 3;
  }

  heading(str: string) {
    this.ensureSpace(20);
    this.y -= 4;
    this.page.drawText(str, { x: MARGIN, y: this.y, size: 10.5, font: this.bold, color: this.ink });
    this.y -= 6;
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: MARGIN + CONTENT_W, y: this.y },
      thickness: 0.75,
      color: this.rule,
    });
    this.y -= 12;
  }

  paragraph(str: string) {
    const lines = wrapLines(str, this.font, 9, CONTENT_W);
    for (const line of lines) {
      this.ensureSpace(12);
      if (line) this.page.drawText(line, { x: MARGIN, y: this.y, size: 9, font: this.font, color: this.ink });
      this.y -= 12;
    }
  }

  /** A simple bordered table; redraws the header row if it spills onto a new page. */
  table(columns: { label: string; width: number }[], rows: string[][]) {
    const rowH = 15;
    const drawHeaderRow = () => {
      this.ensureSpace(rowH * 2);
      const top = this.y;
      let cx = MARGIN;
      for (const col of columns) {
        this.page.drawText(col.label, { x: cx + 3, y: top - rowH + 4, size: 7.5, font: this.bold, color: this.ink });
        cx += col.width;
      }
      this.page.drawLine({ start: { x: MARGIN, y: top }, end: { x: MARGIN + CONTENT_W, y: top }, thickness: 0.75, color: this.rule });
      this.y -= rowH;
      this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: MARGIN + CONTENT_W, y: this.y }, thickness: 0.75, color: this.rule });
    };

    drawHeaderRow();
    for (const row of rows) {
      if (this.y - rowH < MARGIN + 14) {
        this.addPage();
        drawHeaderRow();
      }
      const top = this.y;
      let cx = MARGIN;
      row.forEach((cell, i) => {
        this.page.drawText(cell.slice(0, 60), { x: cx + 3, y: top - rowH + 4, size: 7.5, font: this.font, color: this.ink });
        cx += columns[i].width;
      });
      this.y -= rowH;
      this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: MARGIN + CONTENT_W, y: this.y }, thickness: 0.5, color: this.rule });
    }
    this.y -= 10;
  }
}

export async function buildDailyReportPdf(rawData: DailyReportPdfData): Promise<Uint8Array> {
  const data: DailyReportPdfData = {
    ...rawData,
    projectLabel: sanitize(rawData.projectLabel),
    location: sanitize(rawData.location),
    weather: sanitize(rawData.weather),
    workingHours: sanitize(rawData.workingHours),
    preparedBy: sanitize(rawData.preparedBy),
    workProgress: sanitize(rawData.workProgress),
    equipment: sanitize(rawData.equipment),
    siteEvents: sanitize(rawData.siteEvents),
    issues: sanitize(rawData.issues),
    safety: sanitize(rawData.safety),
    weatherNotes: sanitize(rawData.weatherNotes),
    plannedNextDay: sanitize(rawData.plannedNextDay),
    overallProgress: sanitize(rawData.overallProgress),
    deliveries: rawData.deliveries.map((d) => ({
      material: sanitize(d.material),
      qty: sanitize(d.qty),
      supplier: sanitize(d.supplier),
      condition: sanitize(d.condition),
    })),
    manpower: rawData.manpower.map((m) => ({ role: sanitize(m.role), count: m.count })),
  };

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const headerImage = await doc.embedJpg(Buffer.from(VCDC_HEADER_JPG_BASE64, "base64"));

  const c = new ReportCursor(doc, font, bold);
  c.addPage();

  const headerImgW = CONTENT_W;
  const headerImgH = headerImgW * HEADER_IMG_ASPECT;
  c.page.drawImage(headerImage, { x: MARGIN, y: c.y - headerImgH, width: headerImgW, height: headerImgH });
  c.y -= headerImgH + 10;

  const titleY = c.y;
  c.page.drawText("DAILY CONSTRUCTION REPORT", { x: MARGIN, y: titleY, size: 13, font: bold, color: c.ink });
  const reportNoW = bold.widthOfTextAtSize(`Report No.: ${data.reportNo}`, 9);
  c.page.drawText(`Report No.: ${data.reportNo}`, {
    x: MARGIN + CONTENT_W - reportNoW,
    y: titleY,
    size: 9,
    font: bold,
    color: c.ink,
  });
  c.y -= 18;

  const field = (label: string, value: string) => {
    c.ensureSpace(13);
    const labelW = bold.widthOfTextAtSize(`${label}: `, 9);
    c.page.drawText(`${label}: `, { x: MARGIN, y: c.y, size: 9, font: bold, color: c.ink });
    c.page.drawText(value, { x: MARGIN + labelW, y: c.y, size: 9, font, color: c.ink });
    c.y -= 13;
  };
  field("Project", data.projectLabel);
  field("Location", data.location);
  field("Date", data.reportDate);
  field("Weather", data.weather || "—");
  field("Working Hours", data.workingHours || "—");
  field("Prepared by", data.preparedBy);
  c.gap(8);

  c.heading("1. WORK PROGRESS");
  c.paragraph(data.workProgress || "No work progress reported.");
  c.gap(6);

  c.heading("2. DELIVERIES RECEIVED");
  if (data.deliveries.length > 0) {
    c.text("The following materials were delivered to the site today:");
    c.gap(2);
    c.table(
      [
        { label: "MATERIAL", width: CONTENT_W * 0.34 },
        { label: "QTY", width: CONTENT_W * 0.16 },
        { label: "SUPPLIER", width: CONTENT_W * 0.32 },
        { label: "CONDITION", width: CONTENT_W * 0.18 },
      ],
      data.deliveries.map((d) => [d.material, d.qty, d.supplier, d.condition])
    );
  } else {
    c.text("No deliveries received today.");
  }
  c.gap(6);

  c.heading("3. MANPOWER");
  if (data.manpower.length > 0) {
    const total = data.manpower.reduce((s, m) => s + m.count, 0);
    c.table(
      [
        { label: "PERSONNEL", width: CONTENT_W * 0.75 },
        { label: "NO.", width: CONTENT_W * 0.25 },
      ],
      [...data.manpower.map((m) => [m.role, String(m.count)]), ["Total", String(total)]]
    );
  } else {
    c.text("No manpower recorded.");
  }
  c.gap(6);

  c.heading("4. EQUIPMENT ON SITE");
  c.paragraph(data.equipment || "No equipment recorded.");
  c.gap(6);

  c.heading("5. SITE EVENTS / ACTIVITIES");
  c.paragraph(data.siteEvents || "None reported.");
  c.gap(6);

  c.heading("6. ISSUES / OBSERVATIONS");
  c.paragraph(data.issues || "None reported.");
  c.gap(6);

  c.heading("7. SAFETY");
  c.paragraph(data.safety || "None reported.");
  c.gap(6);

  c.heading("8. WEATHER / WORKING CONDITIONS");
  c.paragraph(data.weatherNotes || "None reported.");
  c.gap(6);

  c.heading("9. PLANNED ACTIVITIES FOR NEXT WORKING DAY");
  c.paragraph(data.plannedNextDay || "None reported.");
  c.gap(6);

  c.heading("10. OVERALL DAILY PROGRESS");
  c.paragraph(data.overallProgress || "None reported.");
  c.gap(24);

  // ---- Signatures ----
  const sigBlock = (label: string, name: string, role: string) => {
    c.ensureSpace(42);
    c.page.drawText(`${label}:`, { x: MARGIN, y: c.y, size: 9, font: bold, color: c.ink });
    c.y -= 26;
    c.page.drawLine({ start: { x: MARGIN, y: c.y }, end: { x: MARGIN + 220, y: c.y }, thickness: 1, color: c.ink });
    c.y -= 11;
    c.page.drawText(name, { x: MARGIN, y: c.y, size: 8.5, font, color: c.ink });
    c.y -= 10;
    c.page.drawText(role, { x: MARGIN, y: c.y, size: 7.5, font, color: c.rule });
    c.y -= 16;
  };
  sigBlock("Prepared by", data.preparedBy, "Site Engineer");
  sigBlock("Checked by", "", "Project Engineer / Project Manager");
  sigBlock("Noted by", "", "Client / Owner's Representative");

  // ---- Page footers ----
  const pages = doc.getPages();
  pages.forEach((page, i) => {
    const label = `Page ${i + 1} of ${pages.length}`;
    const w = font.widthOfTextAtSize(label, 7);
    page.drawText(label, { x: PAGE_W - MARGIN - w, y: MARGIN - 20, size: 7, font, color: c.rule });
  });

  return doc.save();
}
