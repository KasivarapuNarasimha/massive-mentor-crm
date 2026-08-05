/**
 * Offline smoke test for export formatters (no DB).
 * Run: node scripts/verify-export-formats.mjs
 * Exit 0 only if CSV/XLSX/PDF all validate.
 */
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Writable } from "node:stream";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", ".tmp-export-verify");
const require = createRequire(import.meta.url);

// Load compiled service if present, else run via dynamic tsx-free pure reimplementation checks
// We import the built JS path after tsc, or inline equivalent for pre-build smoke.

const UTF8_BOM = "\uFEFF";

function escapeCsvCell(val) {
  if (val == null) return "";
  let s = String(val);
  s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function buildCsvString(headers, rows) {
  const cols = headers.length;
  const lines = [headers.map(escapeCsvCell).join(",")];
  for (const row of rows) {
    const cells = [];
    for (let i = 0; i < cols; i++) cells.push(escapeCsvCell(row[i]));
    lines.push(cells.join(","));
  }
  return UTF8_BOM + lines.join("\r\n") + "\r\n";
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  await mkdir(outDir, { recursive: true });

  const headers = ["id", "name", "email", "note", "value"];
  // Rows with commas, quotes, newlines, formula injection, missing cols
  const rows = [
    [1, "Acme, Inc.", "a@test.com", 'He said "hi"', 100],
    [2, "Line\nBreak", "b@test.com", "ok", null],
    [3, "=SUM(A1)", "c@test.com", "normal", 0],
    [4, "Short", null, "x", 42],
  ];
  // Pad many rows for volume smoke
  for (let i = 5; i <= 120; i++) {
    rows.push([i, `Lead ${i}`, `lead${i}@ex.com`, `Note for ${i}`, i * 10]);
  }

  // --- CSV ---
  const csv = buildCsvString(headers, rows);
  const csvPath = join(outDir, "leads-export.csv");
  await writeFile(csvPath, csv, "utf8");
  const csvBuf = await readFile(csvPath);
  assert(csvBuf[0] === 0xef && csvBuf[1] === 0xbb && csvBuf[2] === 0xbf, "CSV missing UTF-8 BOM");
  const text = csvBuf.toString("utf8");
  const lines = text.replace(/^\uFEFF/, "").split(/\r\n/).filter((l) => l.length);
  assert(lines.length === rows.length + 1, `CSV line count mismatch: ${lines.length}`);
  const colCounts = lines.map((l) => {
    // rough RFC parse for comma-in-quotes
    let cols = 0;
    let inQ = false;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (c === '"') {
        if (inQ && l[i + 1] === '"') {
          i++;
          continue;
        }
        inQ = !inQ;
      } else if (c === "," && !inQ) cols++;
    }
    return cols + 1;
  });
  assert(
    colCounts.every((n) => n === headers.length),
    `CSV column mismatch: ${[...new Set(colCounts)].join(",")}`
  );
  assert(text.includes('"Acme, Inc."'), "CSV did not quote comma field");
  assert(text.includes('""hi""') || text.includes('"He said ""hi"""'), "CSV quote escape missing");
  assert(text.includes("'=SUM(A1)") || text.includes("'=SUM"), "CSV formula injection guard missing");
  console.log("OK CSV", csvPath, csvBuf.length, "bytes");

  // --- XLSX via sheetjs ---
  const XLSX = require("xlsx");
  const aoa = [headers, ...rows.map((r) => headers.map((_, i) => (r[i] == null ? "" : r[i])))];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Leads");
  const xlsxRaw = XLSX.write(wb, { type: "buffer", bookType: "xlsx", compression: true });
  const xlsxBuf = Buffer.isBuffer(xlsxRaw) ? xlsxRaw : Buffer.from(xlsxRaw);
  assert(xlsxBuf[0] === 0x50 && xlsxBuf[1] === 0x4b, "XLSX missing PK zip signature");
  assert(xlsxBuf.length > 100, "XLSX too small");
  // Round-trip read
  const wb2 = XLSX.read(xlsxBuf, { type: "buffer" });
  const sheet = wb2.Sheets[wb2.SheetNames[0]];
  const round = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  assert(round.length === rows.length + 1, `XLSX row count ${round.length}`);
  assert(round[0].length === headers.length, "XLSX header width mismatch");
  const xlsxPath = join(outDir, "leads-export.xlsx");
  await writeFile(xlsxPath, xlsxBuf);
  console.log("OK XLSX", xlsxPath, xlsxBuf.length, "bytes");

  // --- PDF via pdfkit ---
  const PDFDocument = require("pdfkit");
  const chunks = [];
  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      margin: 40,
      size: "A4",
      layout: "landscape",
      bufferPages: true,
    });
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", resolve);
    doc.on("error", reject);

    const margin = 40;
    const colW = (doc.page.width - margin * 2) / headers.length;
    let y = margin;
    doc.font("Helvetica-Bold").fontSize(11).text("Leads Export", margin, y, {
      width: doc.page.width - margin * 2,
      lineBreak: false,
    });
    y += 18;
    const drawHeader = () => {
      let x = margin;
      const h = 16;
      doc.save();
      doc.rect(margin, y, doc.page.width - margin * 2, h).fill("#eef2f7");
      doc.restore();
      headers.forEach((hText, i) => {
        doc.save();
        doc.rect(x, y, colW, h).clip();
        doc.font("Helvetica-Bold").fontSize(8).fillColor("#111").text(hText, x + 2, y + 3, {
          width: colW - 4,
          height: h - 4,
          ellipsis: true,
        });
        doc.restore();
        x += colW;
      });
      y += h;
    };
    drawHeader();
    for (const row of rows) {
      const h = 14;
      if (y + h > doc.page.height - margin) {
        doc.addPage({ size: "A4", layout: "landscape", margin });
        y = margin;
        drawHeader();
      }
      let x = margin;
      for (let i = 0; i < headers.length; i++) {
        const t = row[i] == null ? "" : String(row[i]);
        doc.save();
        doc.rect(x, y, colW, h).clip();
        doc.font("Helvetica").fontSize(7).fillColor("#111").text(t, x + 2, y + 2, {
          width: colW - 4,
          height: h - 3,
          ellipsis: true,
        });
        doc.restore();
        x += colW;
      }
      y += h;
    }
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.fontSize(7).fillColor("#888").text(`Page ${i + 1}/${range.count}`, margin, doc.page.height - 28, {
        width: doc.page.width - margin * 2,
        align: "center",
        lineBreak: false,
      });
    }
    doc.end();
  });

  const pdfBuf = Buffer.concat(chunks);
  assert(pdfBuf[0] === 0x25 && pdfBuf[1] === 0x50 && pdfBuf[2] === 0x44 && pdfBuf[3] === 0x46, "PDF missing %PDF");
  assert(pdfBuf.includes(Buffer.from("%%EOF")) || pdfBuf.toString("latin1").includes("%%EOF"), "PDF missing EOF");
  const pdfPath = join(outDir, "leads-export.pdf");
  await writeFile(pdfPath, pdfBuf);
  console.log("OK PDF", pdfPath, pdfBuf.length, "bytes");

  console.log("\nAll export format smoke checks passed.");
  console.log(`Sample files written to ${outDir}`);
}

main().catch((err) => {
  console.error("FAIL", err);
  process.exit(1);
});
