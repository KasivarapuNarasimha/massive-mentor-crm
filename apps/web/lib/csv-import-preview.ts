/**
 * Client-side CSV/TSV preview for the mapping wizard.
 * Avoids uploading multi‑MB files to /reports/import/preview just to map columns.
 * Full parse + commit still happens once on /reports/import/file.
 */

export type LocalImportPreview = {
  headers: string[];
  sampleRows: Record<string, string>[];
  parsedRows: number;
  suggestions: Array<{
    sourceHeader: string;
    fieldKey: string | null;
    confidence: "high" | "medium" | "low" | "none";
    sampleValues: string[];
  }>;
  crmFields: Array<{ key: string; label: string; required: boolean }>;
  nameMapped: boolean;
  phoneMapped: boolean;
  emailMapped: boolean;
  needsWizard: boolean;
  allowedStatuses: string[];
  autoMappings: Array<{ sourceHeader: string; fieldKey: string }>;
  message?: string;
};

const CRM_FIELDS: Array<{ key: string; label: string; required: boolean }> = [
  { key: "name", label: "Lead Name", required: true },
  { key: "phone", label: "Phone", required: false },
  { key: "email", label: "Email", required: false },
  { key: "company", label: "Company", required: false },
  { key: "status", label: "Status", required: false },
  { key: "value", label: "Value", required: false },
  { key: "source", label: "Source", required: false },
  { key: "type", label: "Type", required: false },
  { key: "description", label: "Description", required: false },
];

function norm(h: string): string {
  return h
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function suggestField(header: string): { fieldKey: string | null; confidence: "high" | "medium" | "low" | "none" } {
  const n = norm(header);
  const rules: Array<[RegExp, string, "high" | "medium" | "low"]> = [
    [/^(name|lead_name|full_name|fullname|student|contact)$/, "name", "high"],
    [/first.?name|firstname/, "name", "high"],
    [/last.?name|lastname|surname/, "name", "medium"],
    [/^(phone|mobile|cell|whatsapp|contact_no|contact_number)$/, "phone", "high"],
    [/^(email|e_mail|mail)$/, "email", "high"],
    [/^(company|organization|org|business|college|school)$/, "company", "high"],
    [/^(status|stage|pipeline)$/, "status", "high"],
    [/^(value|amount|fee|budget|deal_value)$/, "value", "medium"],
    [/^(source|lead_source|channel|origin)$/, "source", "high"],
    [/^(type|record_type)$/, "type", "medium"],
    [/^(description|notes|remark|comments)$/, "description", "medium"],
  ];
  for (const [re, field, conf] of rules) {
    if (re.test(n)) return { fieldKey: field, confidence: conf };
  }
  return { fieldKey: null, confidence: "none" };
}

/** Minimal CSV line split (handles quoted commas). */
function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else inQ = !inQ;
      continue;
    }
    if (!inQ && c === sep) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur.trim());
  return out;
}

export function isCsvLikeFilename(name: string): boolean {
  const l = name.toLowerCase();
  return l.endsWith(".csv") || l.endsWith(".tsv") || l.endsWith(".txt");
}

/**
 * Build a mapping wizard preview from the first chunk of a CSV/TSV file (browser only).
 */
export async function buildClientCsvPreview(
  file: File,
  allowedStatuses: string[] = ["new", "contacted", "qualified", "proposal", "negotiation", "won", "lost"]
): Promise<LocalImportPreview> {
  const sep = file.name.toLowerCase().endsWith(".tsv") ? "\t" : ",";
  // Read first 512KB — enough for headers + samples on wide sheets
  const chunk = file.slice(0, 512 * 1024);
  const text = (await chunk.text()).replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (!lines.length) {
    return {
      headers: [],
      sampleRows: [],
      parsedRows: 0,
      suggestions: [],
      crmFields: CRM_FIELDS,
      nameMapped: false,
      phoneMapped: false,
      emailMapped: false,
      needsWizard: true,
      allowedStatuses,
      autoMappings: [],
      message: "Empty CSV file.",
    };
  }

  const headers = splitCsvLine(lines[0], sep).map((h) => h.replace(/^"|"$/g, "").trim()).filter(Boolean);
  const dataLines = lines.slice(1, 41);
  const sampleRows: Record<string, string>[] = dataLines.slice(0, 5).map((line) => {
    const cols = splitCsvLine(line, sep);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = (cols[i] || "").replace(/^"|"$/g, "");
    });
    return row;
  });

  // Estimate total rows from full file size vs sample density when truncated
  let parsedRows = Math.max(0, lines.length - 1);
  if (file.size > 512 * 1024 && lines.length > 2) {
    const avgLine = chunk.size / lines.length;
    if (avgLine > 0) parsedRows = Math.max(parsedRows, Math.floor(file.size / avgLine) - 1);
  }

  const used = new Set<string>();
  const suggestions: LocalImportPreview["suggestions"] = [];
  const autoMappings: Array<{ sourceHeader: string; fieldKey: string }> = [];

  for (const header of headers) {
    let { fieldKey, confidence } = suggestField(header);
    if (fieldKey && used.has(fieldKey) && fieldKey !== "name") {
      fieldKey = null;
      confidence = "none";
    }
    if (fieldKey && confidence !== "none") {
      used.add(fieldKey);
      autoMappings.push({ sourceHeader: header, fieldKey });
    }
    const sampleValues = sampleRows
      .map((r) => r[header])
      .filter((v) => v)
      .slice(0, 3);
    suggestions.push({
      sourceHeader: header,
      fieldKey,
      confidence,
      sampleValues,
    });
  }

  const nameMapped = autoMappings.some((m) => m.fieldKey === "name");
  const phoneMapped = autoMappings.some((m) => m.fieldKey === "phone");
  const emailMapped = autoMappings.some((m) => m.fieldKey === "email");

  return {
    headers,
    sampleRows,
    parsedRows,
    suggestions,
    crmFields: CRM_FIELDS,
    nameMapped,
    phoneMapped,
    emailMapped,
    needsWizard: true,
    allowedStatuses,
    autoMappings,
    message: nameMapped
      ? undefined
      : `Map a column to Lead Name. Detected: ${headers.join(", ") || "(none)"}`,
  };
}
