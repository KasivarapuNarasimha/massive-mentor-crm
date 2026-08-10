/**
 * Intelligent CSV/Excel contact import for multi-CRM exports
 * (Zoho, HubSpot, Salesforce, Google Sheets, Excel, etc.).
 *
 * Flow: preview → mapping wizard (if needed) → import with optional saved mappings.
 */
import { prisma } from "../lib/prisma.js";
import { getBusinessConfig } from "./template.service.js";
import {
  applyContactFieldDefs,
  getContactFieldDefs,
  getLeadPipelineStatuses,
} from "./field-engine.service.js";
import type { FieldDef } from "../types/template-manifest.js";

// ─── Public types ───────────────────────────────────────────────────────────

export type ImportRowError = {
  row: number;
  column?: string;
  reason: string;
  suggestedFix?: string;
  detectedColumns?: string[];
};

export type ImportReport = {
  parsedRows: number;
  imported: number;
  /** Contacts updated because phone/email already existed */
  updated: number;
  skippedDuplicates: number;
  failed: number;
  skippedEmpty: number;
  errors: ImportRowError[];
  report: string;
  allowedStatuses?: string[];
  /** True when backend refused to auto-import and wants the mapping wizard */
  needsMapping?: boolean;
  mappingPreview?: ImportPreview;
};

export type CrmImportField = {
  key: string;
  label: string;
  required: boolean;
};

export type ColumnSuggestion = {
  sourceHeader: string;
  fieldKey: string | null;
  confidence: "high" | "medium" | "low" | "none";
  sampleValues: string[];
};

export type ImportPreview = {
  headers: string[];
  sampleRows: Record<string, string>[];
  parsedRows: number;
  suggestions: ColumnSuggestion[];
  crmFields: CrmImportField[];
  nameMapped: boolean;
  phoneMapped: boolean;
  emailMapped: boolean;
  needsWizard: boolean;
  allowedStatuses: string[];
  autoMappings: Array<{ sourceHeader: string; fieldKey: string }>;
  message?: string;
};

export type ColumnMapping = { sourceHeader: string; fieldKey: string };

export type ImportOptions = {
  filename?: string;
  /** Explicit user / wizard mappings (source header → CRM field key) */
  mappings?: ColumnMapping[];
  /** Persist mappings into BusinessConfig.importMappings for next time */
  saveMapping?: boolean;
  /** Update existing contacts matched by phone/email instead of skipping */
  updateExisting?: boolean;
};

const CRM_FIELDS: CrmImportField[] = [
  { key: "name", label: "Lead Name", required: true },
  { key: "phone", label: "Phone", required: false },
  { key: "email", label: "Email", required: false },
  { key: "company", label: "Company", required: false },
  { key: "status", label: "Status", required: false },
  { key: "value", label: "Value", required: false },
  { key: "source", label: "Source", required: false },
  { key: "type", label: "Type", required: false },
  { key: "description", label: "Notes / Description", required: false },
  { key: "district", label: "District", required: false },
  { key: "group", label: "Group", required: false },
];

const DEFAULT_ALLOWED_STATUSES: Array<{ key: string; label: string }> = [
  // Primary telecalling workflow
  { key: "new", label: "New" },
  { key: "rnr", label: "RNR" },
  { key: "busy", label: "Busy" },
  { key: "call_back", label: "Call back" },
  { key: "not_interested", label: "Not interested" },
  { key: "interested", label: "Interested" },
  { key: "switch_off", label: "Switch off" },
  { key: "no_incoming_calls", label: "No Incoming calls" },
  { key: "invalid_number", label: "Invalid number" },
  { key: "won", label: "Won" },
  { key: "lost", label: "Lost" },
  // Legacy (existing rows / older configs)
  { key: "contacted", label: "Contacted" },
  { key: "qualified", label: "Qualified" },
  { key: "proposal", label: "Proposal Sent" },
  { key: "negotiation", label: "Negotiation" },
];

/** Normalized header token → CRM field key (Zoho / HubSpot / Salesforce / Sheets / Excel) */
const HEADER_ALIASES: Record<string, string> = {
  // Name
  name: "name",
  fullname: "name",
  fullnameofcontact: "name",
  contactname: "name",
  leadname: "name",
  customername: "name",
  clientname: "name",
  prospectname: "name",
  person: "name",
  personname: "name",
  firstname: "name", // alone; combined with lastname below
  lastname: "name",
  studentname: "name",
  candidatename: "name",
  displayname: "name",
  // Phone
  phone: "phone",
  phonenumber: "phone",
  phone1: "phone",
  phone2: "phone",
  mobile: "phone",
  mobileno: "phone",
  mobilenumber: "phone",
  mobilephone: "phone",
  cellphone: "phone",
  cell: "phone",
  contactnumber: "phone",
  contactno: "phone",
  contactphone: "phone",
  workphone: "phone",
  homephone: "phone",
  whatsapp: "phone",
  whatsappnumber: "phone",
  telephone: "phone",
  tel: "phone",
  primaryphone: "phone",
  // Email
  email: "email",
  emailaddress: "email",
  emailid: "email",
  email1: "email",
  mail: "email",
  inbox: "email",
  primaryemail: "email",
  workemail: "email",
  // Company (Salesforce Account Name = company, not person name)
  company: "company",
  companyname: "company",
  organization: "company",
  organisation: "company",
  org: "company",
  account: "company",
  accountname: "company",
  business: "company",
  businessname: "company",
  employer: "company",
  college: "company",
  collegename: "company",
  institute: "company",
  institution: "company",
  school: "company",
  // Status
  status: "status",
  leadstatus: "status",
  dealstage: "status",
  stage: "status",
  pipeline: "status",
  pipelinestage: "status",
  leadstage: "status",
  lifecycle: "status",
  lifecyclestage: "status",
  // Value
  value: "value",
  amount: "value",
  dealvalue: "value",
  revenue: "value",
  expectedrevenue: "value",
  annualrevenue: "value",
  // Source
  source: "source",
  leadsource: "source",
  origin: "source",
  channel: "source",
  // Type
  type: "type",
  contacttype: "type",
  recordtype: "type",
  // Notes
  description: "description",
  notes: "description",
  note: "description",
  comments: "description",
  remark: "description",
  remarks: "description",
  message: "description",
  // Meta extras
  district: "district",
  city: "district",
  fathername: "fathername",
  group: "group",
  marks: "marks",
  result: "result",
};

const STATUS_ALIASES: Record<string, string> = {
  new: "new",
  newlead: "new",
  fresh: "new",
  open: "new",
  lead: "new",
  subscriber: "new",
  mql: "new",
  sql: "qualified",
  contacted: "contacted",
  called: "contacted",
  attempttocontact: "contacted",
  inprogress: "contacted",
  working: "contacted",
  reachout: "contacted",
  connected: "contacted",
  qualified: "qualified",
  qual: "qualified",
  hot: "qualified",
  warm: "qualified",
  opportunity: "qualified",
  proposal: "proposal",
  proposalsent: "proposal",
  quoted: "proposal",
  quote: "proposal",
  negotiation: "proposal",
  demo: "proposal",
  won: "won",
  closedwon: "won",
  closed: "won",
  converted: "won",
  customer: "won",
  enrolled: "won",
  paid: "won",
  lost: "lost",
  closedlost: "lost",
  rejected: "lost",
  dead: "lost",
  junk: "lost",
  uninterested: "lost",
  disqualified: "lost",
};

// ─── Helpers ────────────────────────────────────────────────────────────────

export function normalizeHeaderKey(raw: string): string {
  return String(raw || "")
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function normalizeStatusToken(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[_\s-]+/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, "");
  if (!digits) return null;
  return digits.length > 10 ? digits.slice(-10) : digits;
}

async function loadXlsx() {
  const XLSX = await import("xlsx");
  return XLSX;
}

export async function rowsFromSheetBuffer(
  buffer: Buffer,
  filename?: string,
  opts?: { /** When set, only first N data rows are parsed (fast preview). */ maxRows?: number }
): Promise<Record<string, unknown>[]> {
  const XLSX = await loadXlsx();
  const lower = (filename || "").toLowerCase();
  const isCsv = lower.endsWith(".csv") || lower.endsWith(".tsv");
  // sheetRows includes header row — +1 so maxRows data rows are available
  const sheetRows =
    opts?.maxRows && opts.maxRows > 0 ? opts.maxRows + 1 : undefined;
  const wb = XLSX.read(buffer, {
    type: "buffer",
    raw: false,
    cellDates: true,
    codepage: 65001,
    ...(sheetRows ? { sheetRows } : {}),
    ...(isCsv ? { FS: lower.endsWith(".tsv") ? "\t" : "," } : {}),
  });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
    raw: false,
    blankrows: false,
  });
  if (opts?.maxRows && rows.length > opts.maxRows) {
    return rows.slice(0, opts.maxRows);
  }
  return rows;
}

/** Rough data-row count for CSV/TSV without full XLSX parse (preview total). */
function estimateCsvDataRows(buffer: Buffer): number {
  try {
    const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
    if (!text.trim()) return 0;
    // Count non-empty lines minus header
    let n = 0;
    for (const line of text.split(/\r?\n/)) {
      if (line.trim()) n++;
    }
    return Math.max(0, n - 1);
  } catch {
    return 0;
  }
}

export async function rowsFromCsvText(csv: string): Promise<Record<string, unknown>[]> {
  const text = csv.replace(/^\uFEFF/, "").trim();
  if (!text) return [];
  const XLSX = await loadXlsx();
  const wb = XLSX.read(text, { type: "string", raw: false, codepage: 65001 });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], {
    defval: "",
    raw: false,
    blankrows: false,
  });
}

function extractHeaders(rows: Record<string, unknown>[]): string[] {
  if (!rows.length) return [];
  const keys = new Set<string>();
  for (const row of rows.slice(0, 50)) {
    for (const k of Object.keys(row)) {
      if (k != null && String(k).trim()) keys.add(String(k).trim());
    }
  }
  // Prefer first-row order
  const first = Object.keys(rows[0] || {}).map((k) => String(k).trim());
  const ordered = first.filter((h) => keys.has(h));
  for (const h of keys) {
    if (!ordered.includes(h)) ordered.push(h);
  }
  return ordered;
}

/**
 * Resolve a single CSV header to a CRM field using aliases, saved mappings, and fuzzy heuristics.
 */
function suggestFieldForHeader(
  header: string,
  saved: ColumnMapping[],
  usedFields: Set<string>
): { fieldKey: string | null; confidence: ColumnSuggestion["confidence"] } {
  const norm = normalizeHeaderKey(header);

  // 1) Built-in exact aliases (Zoho/HubSpot/Salesforce/Sheets) — always prefer over stale saved maps
  const exact = HEADER_ALIASES[norm];
  if (exact) {
    return { fieldKey: exact, confidence: "high" };
  }

  // 2) Fuzzy heuristics (order: company before bare name so Account Name → company)
  const rules: Array<{ re: RegExp; field: string; conf: ColumnSuggestion["confidence"] }> = [
    { re: /company|organisation|organization|employer|college|institute|business.?name|account.?name|^account$|^org$/, field: "company", conf: "high" },
    { re: /customer.?name|client.?name|lead.?name|full.?name|contact.?name|prospect.?name|person.?name|display.?name|^person$|^name$/, field: "name", conf: "high" },
    { re: /first.?name|last.?name|surname|given.?name/, field: "name", conf: "medium" },
    { re: /phone|mobile|cell|whatsapp|telephone|tel|contact.?no|contact.?number|primary.?phone/, field: "phone", conf: "high" },
    { re: /e.?mail|mail|inbox|work.?email|primary.?email/, field: "email", conf: "high" },
    { re: /lead.?status|deal.?stage|life.?cycle|pipeline|stage|status/, field: "status", conf: "high" },
    { re: /amount|revenue|deal.?value|value|worth/, field: "value", conf: "medium" },
    { re: /source|origin|channel|utm/, field: "source", conf: "medium" },
    { re: /note|comment|remark|description|message/, field: "description", conf: "medium" },
    { re: /district|city|location/, field: "district", conf: "low" },
  ];

  for (const rule of rules) {
    if (rule.re.test(norm) || rule.re.test(header.toLowerCase())) {
      return { fieldKey: rule.field, confidence: rule.conf };
    }
  }

  // 3) Saved business mappings for uncommon / industry-specific headers only
  for (const m of saved) {
    if (normalizeHeaderKey(m.sourceHeader) === norm && m.fieldKey) {
      return { fieldKey: m.fieldKey, confidence: "high" };
    }
  }

  return { fieldKey: null, confidence: "none" };
}

function sampleValuesForHeader(rows: Record<string, unknown>[], header: string, n = 3): string[] {
  const out: string[] = [];
  for (const row of rows) {
    // Case-insensitive header match
    let val: unknown;
    if (row[header] !== undefined) val = row[header];
    else {
      const found = Object.keys(row).find((k) => k.trim() === header || normalizeHeaderKey(k) === normalizeHeaderKey(header));
      if (found) val = row[found];
    }
    const s = val == null ? "" : String(val).trim();
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= n) break;
  }
  return out;
}

export function buildImportPreview(
  rows: Record<string, unknown>[],
  savedMappings: ColumnMapping[] = []
): ImportPreview {
  const headers = extractHeaders(rows);
  const used = new Set<string>();
  const suggestions: ColumnSuggestion[] = [];
  const autoMappings: ColumnMapping[] = [];

  // First pass: high-confidence unique assignments
  for (const header of headers) {
    const { fieldKey, confidence } = suggestFieldForHeader(header, savedMappings, used);
    let assigned: string | null = fieldKey;
    let conf = confidence;

    // Avoid double-mapping same CRM field (except name which can combine first+last)
    if (assigned && used.has(assigned) && assigned !== "name") {
      assigned = null;
      conf = "none";
    }
    if (assigned && conf !== "none") {
      used.add(assigned);
      autoMappings.push({ sourceHeader: header, fieldKey: assigned });
    }

    suggestions.push({
      sourceHeader: header,
      fieldKey: assigned,
      confidence: conf,
      sampleValues: sampleValuesForHeader(rows, header),
    });
  }

  // Combine First Name + Last Name into name if both present and name not mapped
  const firstH = headers.find((h) => /firstname|first_name|^first$/i.test(normalizeHeaderKey(h)) || /^first name$/i.test(h.trim()));
  const lastH = headers.find((h) => /lastname|last_name|surname|^last$/i.test(normalizeHeaderKey(h)) || /^last name$/i.test(h.trim()));
  if (firstH && lastH && !autoMappings.some((m) => m.fieldKey === "name")) {
    // Map first name header to name; last is combined at row map time via special key
    autoMappings.push({ sourceHeader: firstH, fieldKey: "name" });
    autoMappings.push({ sourceHeader: lastH, fieldKey: "__lastname" });
    for (const s of suggestions) {
      if (s.sourceHeader === firstH) {
        s.fieldKey = "name";
        s.confidence = "high";
      }
      if (s.sourceHeader === lastH) {
        s.fieldKey = "name";
        s.confidence = "medium";
      }
    }
  }

  const nameMapped = autoMappings.some((m) => m.fieldKey === "name");
  const phoneMapped = autoMappings.some((m) => m.fieldKey === "phone");
  const emailMapped = autoMappings.some((m) => m.fieldKey === "email");
  const lowConf = suggestions.some((s) => s.fieldKey && s.confidence === "low");
  const needsWizard = !nameMapped || lowConf || suggestions.every((s) => !s.fieldKey);

  const sampleRows = rows.slice(0, 5).map((r) => {
    const o: Record<string, string> = {};
    for (const h of headers) {
      const found = Object.keys(r).find((k) => k.trim() === h) || h;
      o[h] = r[found] == null ? "" : String(r[found]);
    }
    return o;
  });

  return {
    headers,
    sampleRows,
    parsedRows: rows.length,
    suggestions,
    crmFields: CRM_FIELDS,
    nameMapped,
    phoneMapped,
    emailMapped,
    needsWizard,
    allowedStatuses: DEFAULT_ALLOWED_STATUSES.map((s) => s.key),
    autoMappings: autoMappings.filter((m) => !m.fieldKey.startsWith("__")),
    message: !nameMapped
      ? `Lead Name column could not be identified confidently. Detected columns: ${headers.join(", ") || "(none)"}. Please map a column to Lead Name.`
      : undefined,
  };
}

/**
 * Apply column mappings to a raw sheet row → canonical field bag.
 * Supports first+last name combination when both map to name.
 */
function applyColumnMappings(
  raw: Record<string, unknown>,
  mappings: ColumnMapping[]
): Record<string, string> {
  const out: Record<string, string> = {};
  const nameParts: string[] = [];

  // Index raw keys case-insensitively
  const rawByNorm = new Map<string, { key: string; val: unknown }>();
  for (const [k, v] of Object.entries(raw)) {
    rawByNorm.set(normalizeHeaderKey(k), { key: k, val: v });
  }

  for (const m of mappings) {
    if (!m.fieldKey || m.fieldKey === "skip" || m.fieldKey === "__skip") continue;
    const hit = rawByNorm.get(normalizeHeaderKey(m.sourceHeader));
    if (!hit) continue;
    const s = hit.val == null ? "" : String(hit.val).trim();
    if (!s) continue;

    if (m.fieldKey === "name" || m.fieldKey === "__lastname") {
      nameParts.push(s);
      continue;
    }
    if (!out[m.fieldKey]) out[m.fieldKey] = s;
  }

  if (nameParts.length) {
    out.name = nameParts.join(" ").replace(/\s+/g, " ").trim();
  }

  // Fallback: static aliases for any unmapped columns not already filled
  for (const [k, v] of Object.entries(raw)) {
    const field = HEADER_ALIASES[normalizeHeaderKey(k)];
    if (!field || out[field]) continue;
    const s = v == null ? "" : String(v).trim();
    if (s) out[field] = s;
  }

  return out;
}

function resolveStatusKey(
  raw: string | null | undefined,
  allowed: Array<{ key: string; label: string }>
): { key: string; warning?: string } {
  if (raw == null || !String(raw).trim()) {
    return { key: allowed[0]?.key || "new" };
  }
  const input = String(raw).trim();
  const token = normalizeStatusToken(input);

  for (const s of allowed) {
    if (normalizeStatusToken(s.key) === token) return { key: s.key };
  }
  for (const s of allowed) {
    if (normalizeStatusToken(s.label) === token) return { key: s.key };
  }
  const aliasKey = STATUS_ALIASES[token];
  if (aliasKey && allowed.some((s) => s.key === aliasKey)) {
    return { key: aliasKey };
  }
  for (const s of allowed) {
    const lk = normalizeStatusToken(s.label);
    if (lk && (token.includes(lk) || lk.includes(token))) return { key: s.key };
  }

  // Soft: do not fail — default to first pipeline stage
  const fallback = allowed[0]?.key || "new";
  return {
    key: fallback,
    warning: `Unrecognized status "${input}" was set to "${fallback}". Allowed: ${allowed.map((s) => s.key).join(", ")}.`,
  };
}

function buildDescription(row: Record<string, string>): string | null {
  if (row.description) return row.description;
  const parts: string[] = [];
  if (row.district) parts.push(`District: ${row.district}`);
  if (row.fathername) parts.push(`Father: ${row.fathername}`);
  if (row.group) parts.push(`Group: ${row.group}`);
  if (row.marks) parts.push(`Marks: ${row.marks}`);
  if (row.result) parts.push(`Result: ${row.result}`);
  return parts.length ? parts.join(" | ") : null;
}

function pushError(
  errors: ImportRowError[],
  row: number,
  reason: string,
  opts?: { column?: string; suggestedFix?: string; detectedColumns?: string[] }
) {
  if (errors.length >= 100) return;
  errors.push({
    row,
    column: opts?.column,
    reason,
    suggestedFix: opts?.suggestedFix,
    detectedColumns: opts?.detectedColumns,
  });
  console.error(
    `[import] Row ${row}${opts?.column ? ` [${opts.column}]` : ""}: ${reason}` +
      (opts?.suggestedFix ? ` | Fix: ${opts.suggestedFix}` : "")
  );
}

function formatRowError(e: ImportRowError): string {
  let line = `Row ${e.row}: ${e.reason}`;
  if (e.suggestedFix) line += ` → ${e.suggestedFix}`;
  return line;
}

async function loadImportContext(userId: string) {
  // Same resolver as CRM list / billing so import never targets a different tenant
  const { getUserBusinessId, reclaimContactsFromDeletedBusinesses } = await import(
    "./field-engine.service.js"
  );
  let businessId = await getUserBusinessId(userId);
  if (businessId) {
    await reclaimContactsFromDeletedBusinesses(userId, businessId).catch(() => 0);
    // Re-resolve after reclaim (counts may change preferred biz)
    businessId = (await getUserBusinessId(userId)) || businessId;
  }

  let savedMappings: ColumnMapping[] = [];
  let fieldDefs: FieldDef[] = [];
  let allowedStatuses = DEFAULT_ALLOWED_STATUSES.slice();

  if (businessId) {
    try {
      const cfg = await getBusinessConfig(businessId);
      if (cfg?.importMappings && Array.isArray(cfg.importMappings)) {
        savedMappings = (cfg.importMappings as ColumnMapping[]).filter(
          (m) => m?.sourceHeader && m?.fieldKey
        );
      }
      fieldDefs = await getContactFieldDefs(businessId);
      const pipeline = await getLeadPipelineStatuses(businessId);
      if (pipeline.length) {
        allowedStatuses = pipeline.map((s) => ({ key: s.key, label: s.label }));
      }
    } catch {
      /* defaults */
    }
  }

  return { businessId, savedMappings, fieldDefs, allowedStatuses };
}

async function saveImportMappings(businessId: string, mappings: ColumnMapping[]) {
  const cleaned = mappings
    .filter((m) => m.sourceHeader && m.fieldKey && m.fieldKey !== "skip")
    .map((m) => ({ sourceHeader: m.sourceHeader, fieldKey: m.fieldKey }));

  const existing = await prisma.businessConfig.findUnique({ where: { businessId } });
  if (!existing) return;

  // Merge: new mappings override same sourceHeader; keep others
  const prev = Array.isArray(existing.importMappings)
    ? (existing.importMappings as ColumnMapping[])
    : [];
  const bySource = new Map<string, ColumnMapping>();
  for (const m of prev) {
    if (m?.sourceHeader) bySource.set(normalizeHeaderKey(m.sourceHeader), m);
  }
  for (const m of cleaned) {
    bySource.set(normalizeHeaderKey(m.sourceHeader), m);
  }

  await prisma.businessConfig.update({
    where: { businessId },
    data: {
      importMappings: Array.from(bySource.values()) as object,
      version: { increment: 1 },
    },
  });
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function previewImportFromCsv(
  userId: string,
  csv: string
): Promise<ImportPreview> {
  const rows = await rowsFromCsvText(csv);
  const { savedMappings, allowedStatuses } = await loadImportContext(userId);
  const preview = buildImportPreview(rows, savedMappings);
  preview.allowedStatuses = allowedStatuses.map((s) => s.key);
  return preview;
}

/**
 * Fast preview: only first PREVIEW_MAX_ROWS are parsed so the HTTP response
 * returns in milliseconds even for multi‑thousand-row Excel/CSV files.
 * Full-file parse happens only on /import/file (commit).
 */
const PREVIEW_MAX_ROWS = 40;

export async function previewImportFromFile(
  userId: string,
  buffer: Buffer,
  filename: string
): Promise<ImportPreview> {
  const lower = filename.toLowerCase();
  const isCsv = lower.endsWith(".csv") || lower.endsWith(".tsv");
  const isSpreadsheet =
    isCsv ||
    lower.endsWith(".xlsx") ||
    lower.endsWith(".xls") ||
    lower.endsWith(".xlsm");
  if (!isSpreadsheet) {
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
      allowedStatuses: DEFAULT_ALLOWED_STATUSES.map((s) => s.key),
      autoMappings: [],
      message: `Unsupported file type: ${filename}. Use CSV or Excel (.xlsx).`,
    };
  }

  let rows: Record<string, unknown>[] = [];
  try {
    // Critical: do NOT parse entire workbook for preview (was causing nginx/client timeouts)
    rows = await rowsFromSheetBuffer(buffer, filename, { maxRows: PREVIEW_MAX_ROWS });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
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
      allowedStatuses: DEFAULT_ALLOWED_STATUSES.map((s) => s.key),
      autoMappings: [],
      message: `Failed to parse file: ${msg}`,
    };
  }

  const { savedMappings, allowedStatuses } = await loadImportContext(userId);
  const preview = buildImportPreview(rows, savedMappings);
  preview.allowedStatuses = allowedStatuses.map((s) => s.key);

  // Prefer real-ish totals for UI without loading all rows into memory as objects
  if (isCsv) {
    const estimated = estimateCsvDataRows(buffer);
    if (estimated > preview.parsedRows) preview.parsedRows = estimated;
  } else if (rows.length >= PREVIEW_MAX_ROWS) {
    // Excel: we only sampled — indicate more rows exist
    preview.parsedRows = Math.max(preview.parsedRows, PREVIEW_MAX_ROWS);
    preview.message =
      (preview.message ? preview.message + " " : "") +
      `Showing first ${PREVIEW_MAX_ROWS} rows for mapping; full file is processed on Import.`;
  }

  return preview;
}

export async function importContactsFromCsv(
  userId: string,
  csv: string,
  options: ImportOptions = {}
): Promise<ImportReport> {
  const rows = await rowsFromCsvText(csv);
  return importContactRows(userId, rows, options);
}

export async function importContactsFromFile(
  userId: string,
  buffer: Buffer,
  filename: string,
  options: ImportOptions = {}
): Promise<ImportReport> {
  const lower = filename.toLowerCase();
  const isSpreadsheet =
    lower.endsWith(".csv") ||
    lower.endsWith(".tsv") ||
    lower.endsWith(".xlsx") ||
    lower.endsWith(".xls") ||
    lower.endsWith(".xlsm");
  if (!isSpreadsheet) {
    return emptyFailReport(`Unsupported file type: ${filename}. Use CSV or Excel (.xlsx/.xls).`);
  }

  let rows: Record<string, unknown>[] = [];
  try {
    rows = await rowsFromSheetBuffer(buffer, filename);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return emptyFailReport(`Failed to parse file: ${msg}`);
  }
  return importContactRows(userId, rows, { ...options, filename });
}

function emptyFailReport(reason: string): ImportReport {
  return {
    parsedRows: 0,
    imported: 0,
    updated: 0,
    skippedDuplicates: 0,
    failed: 0,
    skippedEmpty: 0,
    errors: [{ row: 0, reason, suggestedFix: "Upload a valid CSV or Excel file with a header row." }],
    report: reason,
  };
}

async function importContactRows(
  userId: string,
  rawRows: Record<string, unknown>[],
  options: ImportOptions = {}
): Promise<ImportReport> {
  const filename = options.filename;
  const parsedRows = rawRows.length;
  const errors: ImportRowError[] = [];
  let skippedDuplicates = 0;
  let skippedEmpty = 0;
  let failed = 0;
  let imported = 0;
  let updated = 0;
  const updateExisting = options.updateExisting !== false; // default true for SaaS UX

  const { businessId, savedMappings, fieldDefs, allowedStatuses } = await loadImportContext(userId);
  const headers = extractHeaders(rawRows);
  const preview = buildImportPreview(rawRows, savedMappings);
  preview.allowedStatuses = allowedStatuses.map((s) => s.key);

  // Resolve effective mappings: explicit wizard > auto+saved
  let mappings: ColumnMapping[] =
    options.mappings && options.mappings.length
      ? options.mappings.filter((m) => m.fieldKey && m.fieldKey !== "skip")
      : preview.autoMappings.slice();

  // If first+last detected and user didn't provide, add lastname companion
  if (!options.mappings?.length) {
    const firstH = headers.find((h) => /firstname|first_name/.test(normalizeHeaderKey(h)) || /^first name$/i.test(h));
    const lastH = headers.find((h) => /lastname|last_name|surname/.test(normalizeHeaderKey(h)) || /^last name$/i.test(h));
    if (firstH && lastH) {
      const hasFirst = mappings.some((m) => normalizeHeaderKey(m.sourceHeader) === normalizeHeaderKey(firstH));
      const hasLast = mappings.some((m) => normalizeHeaderKey(m.sourceHeader) === normalizeHeaderKey(lastH));
      if (hasFirst && !hasLast) {
        mappings.push({ sourceHeader: lastH, fieldKey: "name" });
      }
    }
  }

  const nameMapped = mappings.some((m) => m.fieldKey === "name");

  // Block auto-import when name cannot be determined — return wizard payload (not a hard crash)
  if (!nameMapped && parsedRows > 0) {
    return {
      parsedRows,
      imported: 0,
      updated: 0,
      skippedDuplicates: 0,
      failed: 0,
      skippedEmpty: 0,
      needsMapping: true,
      mappingPreview: preview,
      errors: [
        {
          row: 0,
          column: "Lead Name",
          reason: "Lead Name column could not be identified.",
          suggestedFix: `Please map one of these columns to Lead Name: ${headers.join(", ") || "(no headers found)"}`,
          detectedColumns: headers,
        },
      ],
      report: [
        "Import paused — column mapping required.",
        preview.message || "Lead Name column could not be identified.",
        `Detected columns: ${headers.join(", ") || "(none)"}`,
        'Please map a column to Lead Name and re-import.',
      ].join("\n"),
      allowedStatuses: allowedStatuses.map((s) => s.key),
    };
  }

  if (parsedRows === 0) {
    return {
      parsedRows: 0,
      imported: 0,
      updated: 0,
      skippedDuplicates: 0,
      failed: 0,
      skippedEmpty: 0,
      errors: [
        {
          row: 0,
          reason: "No data rows found in the file.",
          suggestedFix: "Ensure the file has a header row and at least one data row.",
          detectedColumns: headers,
        },
      ],
      report: "Import report: 0 rows parsed.",
      allowedStatuses: allowedStatuses.map((s) => s.key),
      mappingPreview: preview,
    };
  }

  if (options.saveMapping && businessId && mappings.length) {
    try {
      await saveImportMappings(businessId, mappings);
    } catch (e) {
      console.error("[import] failed to save mappings:", e);
    }
  }

  // Existing contacts for duplicate / update — scoped to this workspace only
  const existing = await prisma.contact.findMany({
    where: businessId
      ? { OR: [{ businessId }, { userId, businessId: null }], deletedAt: null }
      : { userId, deletedAt: null },
    select: { id: true, phone: true, email: true },
  });
  const phoneToId = new Map<string, string>();
  const emailToId = new Map<string, string>();
  for (const c of existing) {
    const p = normalizePhone(c.phone);
    if (p) phoneToId.set(p, c.id);
    if (c.email) emailToId.set(c.email.trim().toLowerCase(), c.id);
  }

  const phoneRequired = fieldDefs.some(
    (f) => f.required && (f.coreMap === "phone" || f.key === "phone")
  );

  type Pending = {
    userId: string;
    businessId: string | null;
    type: string;
    name: string;
    email: string | null;
    phone: string | null;
    company: string | null;
    status: string;
    value: number | null;
    source: string | null;
    description: string | null;
    customFields: object;
    _rowNum: number;
    _existingId?: string;
  };

  const pending: Pending[] = [];

  for (let idx = 0; idx < rawRows.length; idx++) {
    const raw = rawRows[idx];
    const rowNum = idx + 2;
    const r = applyColumnMappings(raw, mappings);

    // Field engine for custom fields / coercion
    const applied = applyContactFieldDefs(fieldDefs, r as Record<string, unknown>, { partial: true });

    if (applied.errors?.length) {
      for (const err of applied.errors) {
        const lower = err.toLowerCase();
        let col = "Validation";
        if (lower.includes("email")) col = "Email";
        else if (lower.includes("phone")) col = "Phone";
        else if (lower.includes("value") || lower.includes("number")) col = "Value";
        else if (lower.includes("name")) col = "Lead Name";
        pushError(errors, rowNum, err.endsWith(".") ? err : `${err}.`, {
          column: col,
          suggestedFix: "Correct the value format in your spreadsheet and re-import.",
        });
      }
      failed++;
      continue;
    }

    const name = (applied.core.name || r.name || "").toString().trim();
    if (!name) {
      skippedEmpty++;
      pushError(errors, rowNum, "Lead Name is empty for this row.", {
        column: "Lead Name",
        suggestedFix: "Fill in the name cell, or map a different CSV column to Lead Name.",
        detectedColumns: headers,
      });
      continue;
    }

    const phoneRaw = (applied.core.phone as string) || r.phone || null;
    const phoneNorm = normalizePhone(phoneRaw);
    if (phoneRequired && !phoneNorm) {
      failed++;
      pushError(errors, rowNum, "Phone number is required by your CRM template.", {
        column: "Phone",
        suggestedFix: "Add a phone value or map Mobile / Contact Number to Phone.",
        detectedColumns: headers,
      });
      continue;
    }

    const emailRaw = applied.core.email || r.email || null;
    const email = emailRaw ? String(emailRaw).trim().toLowerCase() : null;
    // Soft: invalid email is dropped so the row still imports
    const safeEmail = email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;

    // Match existing for update
    let existingId: string | undefined;
    if (phoneNorm && phoneToId.has(phoneNorm)) existingId = phoneToId.get(phoneNorm);
    else if (safeEmail && emailToId.has(safeEmail)) existingId = emailToId.get(safeEmail);

    if (existingId && !updateExisting) {
      skippedDuplicates++;
      pushError(errors, rowNum, "Contact already exists (matched by phone or email).", {
        column: phoneNorm ? "Phone" : "Email",
        suggestedFix: "Enable “Update existing” or remove the row from the file.",
      });
      continue;
    }

    // Soft status normalization — never fail the row for casing / unknown labels
    const statusRaw = (applied.core.status as string) || r.status || "";
    const statusResolved = resolveStatusKey(statusRaw || "new", allowedStatuses);
    if (statusResolved.warning) {
      // Non-fatal: log only (row still imports with default stage)
      console.warn(`[import] Row ${rowNum}: ${statusResolved.warning}`);
    }

    let value: number | null =
      applied.core.value !== undefined ? (applied.core.value as number | null) : null;
    if (value === null && r.value) {
      const n = parseFloat(String(r.value).replace(/[,$]/g, ""));
      if (!Number.isNaN(n)) value = n;
    }

    const type = (r.type || "lead").toLowerCase() === "client" ? "client" : "lead";

    // Reserve keys for intra-file de-dupe of creates
    if (!existingId) {
      if (phoneNorm) phoneToId.set(phoneNorm, "__pending__");
      if (safeEmail) emailToId.set(safeEmail, "__pending__");
    }

    pending.push({
      userId,
      businessId,
      type,
      name,
      email: safeEmail,
      phone: phoneRaw ? String(phoneRaw).trim() : null,
      company: (applied.core.company as string) || r.company || null,
      status: statusResolved.key,
      value,
      source: r.source || (filename ? `import:${filename}` : "csv-import"),
      description: (applied.core.description as string) || buildDescription(r) || null,
      customFields: (applied.customFields || {}) as object,
      _rowNum: rowNum,
      _existingId: existingId,
    });
  }

  // Updates first (must be per-row), then batch-create inserts for performance (38k+ files)
  const toCreate: Omit<Pending, "_rowNum" | "_existingId">[] = [];
  const createRowNums: number[] = [];

  for (const row of pending) {
    const { _rowNum, _existingId, ...data } = row;
    if (_existingId && _existingId !== "__pending__") {
      try {
        await prisma.contact.update({
          where: { id: _existingId },
          data: {
            name: data.name,
            email: data.email,
            phone: data.phone,
            company: data.company,
            status: data.status,
            value: data.value,
            source: data.source,
            description: data.description,
            customFields: data.customFields,
            type: data.type,
            ...(data.businessId ? { businessId: data.businessId } : {}),
          },
        });
        updated++;
        if (data.phone) {
          const p = normalizePhone(data.phone);
          if (p) phoneToId.set(p, _existingId);
        }
        if (data.email) emailToId.set(data.email, _existingId);
      } catch (rowErr: unknown) {
        failed++;
        const msg = rowErr instanceof Error ? rowErr.message : String(rowErr);
        pushError(errors, _rowNum, msg, {
          column: "Database",
          suggestedFix: "Check the row data and try again.",
        });
      }
    } else {
      toCreate.push(data);
      createRowNums.push(_rowNum);
    }
  }

  const BATCH = 500;
  for (let i = 0; i < toCreate.length; i += BATCH) {
    const chunk = toCreate.slice(i, i + BATCH);
    const rowNums = createRowNums.slice(i, i + BATCH);
    try {
      const res = await prisma.contact.createMany({
        data: chunk.map((d) => ({
          userId: d.userId,
          businessId: d.businessId,
          type: d.type,
          name: d.name,
          email: d.email,
          phone: d.phone,
          company: d.company,
          status: d.status,
          value: d.value,
          source: d.source,
          description: d.description,
          customFields: d.customFields,
        })),
        skipDuplicates: true,
      });
      imported += res.count;
      // If some skipped by DB unique constraints, count the gap as failed/dupes
      const skipped = chunk.length - res.count;
      if (skipped > 0) {
        skippedDuplicates += skipped;
      }
    } catch (batchErr: unknown) {
      // Fallback: per-row create so one bad row does not drop the batch
      for (let j = 0; j < chunk.length; j++) {
        try {
          await prisma.contact.create({ data: chunk[j] });
          imported++;
        } catch (rowErr: unknown) {
          failed++;
          const msg = rowErr instanceof Error ? rowErr.message : String(rowErr);
          let reason = msg;
          let suggestedFix = "Check the row data and try again.";
          if (/Unique constraint/i.test(msg)) {
            reason = "Database rejected row (unique constraint).";
            suggestedFix =
              "A contact with this phone/email may already exist under another account.";
          } else if (/Foreign key/i.test(msg)) {
            reason = "Database rejected row (invalid reference).";
            suggestedFix = "Re-login and try again; your workspace link may be missing.";
          }
          pushError(errors, rowNums[j], reason, { column: "Database", suggestedFix });
        }
      }
    }
  }

  const errorLines = errors.slice(0, 50).map(formatRowError);
  const report = [
    `Import Report${filename ? ` — ${filename}` : ""}`,
    `Parsed rows: ${parsedRows}`,
    `Successfully imported: ${imported}`,
    `Updated existing: ${updated}`,
    `Duplicates skipped: ${skippedDuplicates}`,
    `Skipped (empty name): ${skippedEmpty}`,
    `Failed rows: ${failed}`,
    `Allowed status values: ${allowedStatuses.map((s) => s.key).join(", ")}`,
    `Column mapping: ${mappings.map((m) => `${m.sourceHeader}→${m.fieldKey}`).join(", ") || "(auto)"}`,
    imported + updated > 0
      ? "Result: SUCCESS — records written to Leads/Contacts."
      : "Result: NO WRITES — nothing was inserted or updated.",
    errorLines.length ? "Issues:" : "",
    ...errorLines,
    errors.length > 50 ? `…and ${errors.length - 50} more.` : "",
  ]
    .filter(Boolean)
    .join("\n");

  console.log("[import]", report.replace(/\n/g, " | "));

  return {
    parsedRows,
    imported,
    updated,
    skippedDuplicates,
    failed,
    skippedEmpty,
    errors,
    report,
    allowedStatuses: allowedStatuses.map((s) => s.key),
  };
}
