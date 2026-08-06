/**
 * Production export formatters:
 * - RFC 4180 CSV (UTF-8 BOM, CRLF, consistent columns)
 * - Real Office Open XML (.xlsx) via SheetJS
 * - Multi-page PDF tables with wrap, clip, repeated headers
 */
import type PDFKit from "pdfkit";

/** UTF-8 BOM so Excel on Windows detects UTF-8 instead of ANSI */
export const UTF8_BOM = "\uFEFF";

/** RFC 4180 cell escape — consistent columns when every cell is escaped the same way */
export function escapeCsvCell(val: unknown): string {
  if (val == null) return "";
  let s: string;
  if (val instanceof Date) s = val.toISOString();
  else if (typeof val === "object") {
    try {
      s = JSON.stringify(val);
    } catch {
      s = String(val);
    }
  } else s = String(val);

  // Normalize line endings inside cells
  s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  // Formula injection guard for Excel/Sheets
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Ensure every row has exactly colCount columns */
export function normalizeRow(row: unknown[], colCount: number): string[] {
  const out: string[] = new Array(colCount);
  for (let i = 0; i < colCount; i++) {
    out[i] = escapeCsvCell(row[i]);
  }
  return out;
}

/**
 * Build full CSV string.
 * Uses CRLF line endings (Excel-friendly RFC 4180). Always ends with trailing CRLF.
 */
export function buildCsvString(
  headers: string[],
  rows: unknown[][],
  opts?: { bom?: boolean }
): string {
  const cols = headers.length;
  const lines: string[] = new Array(rows.length + 1);
  lines[0] = normalizeRow(headers, cols).join(",");
  for (let i = 0; i < rows.length; i++) {
    lines[i + 1] = normalizeRow(rows[i] ?? [], cols).join(",");
  }
  const body = lines.join("\r\n") + "\r\n";
  return (opts?.bom === false ? "" : UTF8_BOM) + body;
}

/** Write one CSV line including CRLF (no BOM) */
export function csvLine(cells: unknown[], colCount: number): string {
  return normalizeRow(cells, colCount).join(",") + "\r\n";
}

/**
 * Stream CSV to a writable (Express res). Memory-friendly for large row sets.
 * Caller must set Content-Type / Content-Disposition before calling.
 */
export function streamCsvTo(
  res: NodeJS.WritableStream,
  headers: string[],
  rows: unknown[][],
  opts?: { bom?: boolean }
): void {
  const cols = headers.length;
  if (opts?.bom !== false) {
    res.write(UTF8_BOM, "utf8");
  }
  res.write(csvLine(headers, cols), "utf8");
  for (const row of rows) {
    res.write(csvLine(row ?? [], cols), "utf8");
  }
  if (typeof (res as NodeJS.WritableStream & { end?: () => void }).end === "function") {
    (res as NodeJS.WritableStream & { end: () => void }).end();
  }
}

/** Validate OOXML zip signature (PK\x03\x04 etc.) */
export function isValidXlsxBuffer(buf: Buffer): boolean {
  return (
    Buffer.isBuffer(buf) &&
    buf.length > 4 &&
    buf[0] === 0x50 &&
    buf[1] === 0x4b &&
    (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07) &&
    (buf[3] === 0x04 || buf[3] === 0x06 || buf[3] === 0x08)
  );
}

function cellToSheetValue(v: unknown): string | number | boolean {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "boolean") return v;
  if (typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

/**
 * Build a real .xlsx workbook via SheetJS (xlsx package).
 * Never HTML-as-xls. Validates OOXML magic bytes before return.
 */
export async function buildXlsxBuffer(
  sheetName: string,
  headers: string[],
  rows: unknown[][]
): Promise<Buffer> {
  const XLSX = await import("xlsx");
  const cols = headers.length;
  const aoa: (string | number | boolean)[][] = [headers.map((h) => String(h ?? ""))];
  for (const row of rows) {
    const r: (string | number | boolean)[] = new Array(cols);
    for (let i = 0; i < cols; i++) {
      r[i] = cellToSheetValue(row?.[i]);
    }
    aoa.push(r);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // Column widths from content sample (first 200 rows)
  ws["!cols"] = headers.map((h, i) => {
    let max = String(h).length;
    const sample = Math.min(rows.length, 200);
    for (let r = 0; r < sample; r++) {
      const len = String(rows[r]?.[i] ?? "").length;
      if (len > max) max = len;
    }
    return { wch: Math.min(48, Math.max(10, max + 2)) };
  });
  const wb = XLSX.utils.book_new();
  const safeName =
    (sheetName || "Export").replace(/[\\/?*[\]]/g, " ").replace(/'/g, "").trim().slice(0, 31) ||
    "Export";
  XLSX.utils.book_append_sheet(wb, ws, safeName);
  const raw = XLSX.write(wb, {
    type: "buffer",
    bookType: "xlsx",
    compression: true,
    cellStyles: false,
  });
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
  if (!isValidXlsxBuffer(buf)) {
    throw new Error("Generated XLSX failed validation (invalid OOXML signature)");
  }
  // Secondary sanity: must be a zip with [Content_Types].xml typically present —
  // PK signature is enough for Excel/Sheets/LibreOffice open checks.
  return buf;
}

type PdfTableOpts = {
  title: string;
  headers: string[];
  rows: unknown[][];
  /** Soft cap — PDF of 50k rows is huge; default 15k with notice */
  maxRows?: number;
};

function cellText(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  // Keep PDF cells readable — truncate extreme values after wrap measure
  const s = String(v);
  return s.length > 500 ? s.slice(0, 497) + "…" : s;
}

/**
 * Professional multi-page PDF table:
 * - landscape when many columns
 * - auto column widths from page size
 * - text wrap + measured row height
 * - per-cell clip (no overlap / bleed)
 * - repeated headers on every page
 * - proper margins
 */
export async function streamPdfTable(
  res: NodeJS.WritableStream,
  opts: PdfTableOpts
): Promise<void> {
  const PDFDocument = (await import("pdfkit")).default as typeof PDFKit;
  const headers = opts.headers.map((h) => String(h ?? ""));
  const maxRows = opts.maxRows ?? 15_000;
  const sourceRows = opts.rows;
  const rows = sourceRows.length > maxRows ? sourceRows.slice(0, maxRows) : sourceRows;
  const truncated = sourceRows.length > maxRows;

  const colCount = Math.max(headers.length, 1);
  const landscape = colCount > 5;
  const margin = 40;
  const pad = 3;

  const doc = new PDFDocument({
    margin,
    size: "A4",
    layout: landscape ? "landscape" : "portrait",
    autoFirstPage: true,
    bufferPages: true,
    info: {
      Title: `${opts.title} Export`,
      Author: "Massive Mentor CRM",
      Creator: "Massive Mentor CRM",
    },
  });

  const done = new Promise<void>((resolve, reject) => {
    doc.on("end", () => resolve());
    doc.on("error", (err: Error) => reject(err));
    if (typeof (res as NodeJS.EventEmitter).on === "function") {
      (res as NodeJS.EventEmitter).on("error", (err: Error) => reject(err));
    }
  });

  doc.pipe(res as NodeJS.WritableStream);

  const pageWidth = () => doc.page.width;
  const pageHeight = () => doc.page.height;
  const contentWidth = () => pageWidth() - margin * 2;
  const bottomLimit = () => pageHeight() - margin - 18;

  // Proportional column widths from header + sample content
  const weights = headers.map((h, i) => {
    let w = Math.max(String(h).length, 4);
    const sample = Math.min(rows.length, 80);
    for (let r = 0; r < sample; r++) {
      w = Math.max(w, Math.min(cellText(rows[r]?.[i]).length, 36));
    }
    return Math.min(w, 36);
  });
  const weightSum = weights.reduce((a, b) => a + b, 0) || 1;
  let colWidths = weights.map((w) => (w / weightSum) * contentWidth());
  // Floor then renormalize so columns never collide
  const minW = Math.max(36, Math.min(56, contentWidth() / colCount));
  colWidths = colWidths.map((w) => Math.max(w, minW));
  const sumW = colWidths.reduce((a, b) => a + b, 0);
  if (sumW > contentWidth()) {
    colWidths = colWidths.map((w) => (w / sumW) * contentWidth());
  }

  // Font size scales with column density
  let fontSize = colCount > 12 ? 5.5 : colCount > 9 ? 6.5 : colCount > 6 ? 7.5 : 8.5;
  const headerFontSize = fontSize + 0.5;
  const titleFontSize = 11;
  const metaFontSize = 7.5;

  const measureRowHeight = (cells: string[], fSize: number, maxH: number): number => {
    let maxMeasured = fSize + pad * 2;
    doc.font("Helvetica").fontSize(fSize);
    for (let i = 0; i < cells.length; i++) {
      const text = cells[i] || " ";
      const h = doc.heightOfString(text, {
        width: Math.max(8, colWidths[i]! - pad * 2),
        lineGap: 0,
      });
      if (h + pad * 2 > maxMeasured) maxMeasured = h + pad * 2;
    }
    return Math.min(Math.max(maxMeasured, fSize + pad * 2), maxH);
  };

  /** Draw a single clipped cell — never bleeds into neighbors */
  const drawCell = (
    text: string,
    x: number,
    y: number,
    w: number,
    h: number,
    fSize: number,
    bold: boolean
  ) => {
    doc.save();
    doc.rect(x, y, w, h).clip();
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(fSize).fillColor("#111111");
    doc.text(text || " ", x + pad, y + pad, {
      width: Math.max(4, w - pad * 2),
      height: Math.max(4, h - pad * 2),
      align: "left",
      lineGap: 0,
      ellipsis: true,
    });
    doc.restore();
  };

  const drawHeaderRow = (y: number): number => {
    const cells = headers;
    const h = measureRowHeight(cells, headerFontSize, 40);
    doc.save();
    doc.rect(margin, y, contentWidth(), h).fill("#eef2f7");
    doc.restore();

    let x = margin;
    for (let i = 0; i < cells.length; i++) {
      drawCell(cells[i]!, x, y, colWidths[i]!, h, headerFontSize, true);
      x += colWidths[i]!;
    }
    doc
      .moveTo(margin, y + h)
      .lineTo(margin + contentWidth(), y + h)
      .strokeColor("#c5cdd8")
      .lineWidth(0.6)
      .stroke();
    return y + h;
  };

  const drawTitleBlock = (): number => {
    let y = margin;
    doc.font("Helvetica-Bold").fontSize(titleFontSize).fillColor("#111111");
    doc.text(`${opts.title} Export`, margin, y, {
      width: contentWidth(),
      align: "left",
      lineBreak: false,
      ellipsis: true,
    });
    y += titleFontSize + 6;
    doc.font("Helvetica").fontSize(metaFontSize).fillColor("#555555");
    const meta = `Generated ${new Date().toISOString()}  ·  ${rows.length.toLocaleString("en-IN")} row(s)${
      truncated
        ? `  ·  Showing first ${maxRows.toLocaleString("en-IN")} of ${sourceRows.length.toLocaleString("en-IN")} (use CSV/XLSX for full export)`
        : ""
    }`;
    doc.text(meta, margin, y, {
      width: contentWidth(),
      align: "left",
      lineBreak: true,
    });
    y += metaFontSize + (truncated ? metaFontSize + 8 : 6) + 4;
    doc.fillColor("#111111");
    return y;
  };

  const startNewPage = (withTitle: boolean): number => {
    doc.addPage({
      size: "A4",
      layout: landscape ? "landscape" : "portrait",
      margin,
    });
    let y = withTitle ? drawTitleBlock() : margin;
    y = drawHeaderRow(y);
    return y;
  };

  let y = drawTitleBlock();
  y = drawHeaderRow(y);

  for (const row of rows) {
    const cells = headers.map((_, i) => cellText(Array.isArray(row) ? row[i] : undefined));
    // Shrink font slightly for very long cells
    let fSize = fontSize;
    if (cells.some((c) => c.length > 120)) fSize = Math.max(5, fontSize - 1);
    if (cells.some((c) => c.length > 250)) fSize = Math.max(5, fontSize - 1.5);

    let h = measureRowHeight(cells, fSize, 64);

    // Page break before drawing if row won't fit
    if (y + h > bottomLimit()) {
      y = startNewPage(false);
      h = measureRowHeight(cells, fSize, 64);
    }

    let x = margin;
    for (let i = 0; i < cells.length; i++) {
      drawCell(cells[i]!, x, y, colWidths[i]!, h, fSize, false);
      x += colWidths[i]!;
    }
    doc
      .moveTo(margin, y + h)
      .lineTo(margin + contentWidth(), y + h)
      .strokeColor("#e8ecf1")
      .lineWidth(0.3)
      .stroke();
    y += h;
  }

  // Page numbers on all buffered pages
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const footerY = pageHeight() - margin + 4;
    doc.font("Helvetica").fontSize(7).fillColor("#888888");
    doc.text(`Massive Mentor CRM  ·  Page ${i + 1} of ${range.count}`, margin, footerY, {
      width: contentWidth(),
      align: "center",
      lineBreak: false,
    });
  }

  doc.end();
  await done;
}
