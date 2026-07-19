/** Client-side export helpers for Super Admin tables */

export function downloadBlob(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function toCsv(rows: Array<Record<string, unknown>>, columns?: string[]) {
  if (!rows.length) return "";
  const cols = columns || Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [cols.join(",")];
  for (const r of rows) {
    lines.push(cols.map((c) => esc(r[c])).join(","));
  }
  return lines.join("\n");
}

export function exportCsv(filename: string, rows: Array<Record<string, unknown>>, columns?: string[]) {
  downloadBlob(filename.endsWith(".csv") ? filename : `${filename}.csv`, toCsv(rows, columns), "text/csv;charset=utf-8");
}

/** Simple HTML table export that Excel can open */
export function exportExcelHtml(filename: string, rows: Array<Record<string, unknown>>, columns?: string[]) {
  if (!rows.length) return;
  const cols = columns || Object.keys(rows[0]);
  const th = cols.map((c) => `<th>${c}</th>`).join("");
  const body = rows
    .map((r) => `<tr>${cols.map((c) => `<td>${r[c] == null ? "" : String(r[c])}</td>`).join("")}</tr>`)
    .join("");
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><table border="1"><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></body></html>`;
  downloadBlob(
    filename.endsWith(".xls") ? filename : `${filename}.xls`,
    html,
    "application/vnd.ms-excel"
  );
}

/** Lightweight printable PDF via browser print dialog */
export function exportPdfPrint(title: string, rows: Array<Record<string, unknown>>, columns?: string[]) {
  if (!rows.length) return;
  const cols = columns || Object.keys(rows[0]);
  const th = cols.map((c) => `<th style="text-align:left;padding:6px;border-bottom:1px solid #ccc">${c}</th>`).join("");
  const body = rows
    .map(
      (r) =>
        `<tr>${cols
          .map((c) => `<td style="padding:6px;border-bottom:1px solid #eee;font-size:12px">${r[c] == null ? "" : String(r[c])}</td>`)
          .join("")}</tr>`
    )
    .join("");
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(`
    <html><head><title>${title}</title></head>
    <body style="font-family:system-ui;padding:24px">
      <h1 style="font-size:18px">${title}</h1>
      <p style="color:#666;font-size:12px">Generated ${new Date().toLocaleString()}</p>
      <table style="width:100%;border-collapse:collapse">${th ? `<thead><tr>${th}</tr></thead>` : ""}
      <tbody>${body}</tbody></table>
      <script>window.onload=()=>window.print()</script>
    </body></html>
  `);
  w.document.close();
}
