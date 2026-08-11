"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { DynamicForm, buildContactPayload, contactToFormValues } from "@/components/dynamic/DynamicForm";
import { ExportFiltersBar } from "@/components/ui/ExportFiltersBar";
import {
  CsvImportWizard,
  type ImportPreview as CsvImportPreview,
} from "@/components/import/CsvImportWizard";
import {
  buildClientCsvPreview,
  isCsvLikeFilename,
} from "@/lib/csv-import-preview";
import {
  AiLeadRecommendationBadge,
  type AiFollowupRec,
} from "@/components/ai/AiFollowupCenter";
import { SendMediaModal } from "@/components/media/SendMediaModal";
import {
  type FieldDef,
  type BusinessConfigDTO,
  type PipelineStatus,
  contactFieldsFromConfig,
  listFields,
  filterFields,
  leadStatusesFromConfig,
  getContactFieldValue,
  FALLBACK_CONTACT_FIELDS,
  FALLBACK_LEAD_STATUSES,
  ensureLeadFormFields,
} from "@/lib/business-config";
import { formatCurrency, parseAmount } from "@/lib/currency";
import { friendlyError, SuccessMsg } from "@/lib/user-messages";

interface Contact {
  id: string;
  type: string;
  status: string;
  name: string;
  email?: string;
  phone?: string;
  whatsapp?: string | null;
  company?: string;
  source?: string;
  value?: number;
  description?: string;
  lastContactedAt?: string;
  aiScore?: number | null;
  assignedTo?: string | null;
  priority?: string | null;
  tags?: string[] | string | null;
  customFields?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  district?: string;
  group?: string;
  [key: string]: unknown;
}

type ImportRowError = {
  row: number;
  column?: string;
  reason: string;
  suggestedFix?: string;
  detectedColumns?: string[];
};

type ImportReport = {
  parsedRows: number;
  imported: number;
  updated?: number;
  skippedDuplicates: number;
  failed: number;
  skippedEmpty?: number;
  errors?: ImportRowError[];
  report?: string;
  allowedStatuses?: string[];
};

function formatImportError(e: ImportRowError): string {
  if (e.reason.toLowerCase().startsWith("row ")) return e.reason;
  return `Row ${e.row}: ${e.reason}`;
}

const PAGE_SIZE = 50;

/** Parse District / Group from import description text (UI-only; no schema change). */
function parseLeadMeta(description?: string | null): { district: string; group: string } {
  if (!description) return { district: "", group: "" };
  const d = description.match(/District:\s*([^|]+)/i);
  const g = description.match(/Group:\s*([^|]+)/i);
  return {
    district: d?.[1]?.trim() || "",
    group: g?.[1]?.trim() || "",
  };
}

function digitsOnly(phone?: string | null): string {
  return (phone || "").replace(/\D/g, "");
}

function ScoreBadge({ score }: { score: number }) {
  const label = score >= 80 ? "Hot" : score >= 50 ? "Warm" : "Cold";
  const colorClass =
    score >= 80
      ? "bg-red-500/20 text-red-400 border-red-500/30"
      : score >= 50
        ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
        : "bg-blue-500/20 text-blue-400 border-blue-500/30";
  return (
    <span className={`inline-block px-2.5 py-0.5 text-xs rounded-full border ${colorClass}`}>
      {label} ({score})
    </span>
  );
}

export default function LeadsPage() {
  const { token, role } = useAuth();
  const searchParams = useSearchParams();
  const [leads, setLeads] = useState<Contact[]>([]);
  /** Server total from CRM list API (must match Dashboard "My Leads") */
  const [serverTotal, setServerTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  // Analytics drill-down: ?status= & ?search=
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [urlFiltersApplied, setUrlFiltersApplied] = useState(false);

  useEffect(() => {
    const qSearch = searchParams.get("search") || "";
    const qStatus = searchParams.get("status") || "";
    if (qSearch) setSearch(qSearch);
    if (qStatus) setStatusFilter(qStatus);
    if (qSearch || qStatus) setUrlFiltersApplied(true);
  }, [searchParams]);
  const [metaFilters, setMetaFilters] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showModal, setShowModal] = useState(false);
  const [editingLead, setEditingLead] = useState<Contact | null>(null);
  const [formValues, setFormValues] = useState<Record<string, unknown>>({});
  const [bizConfig, setBizConfig] = useState<BusinessConfigDTO | null>(null);
  const [templateSlug, setTemplateSlug] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  /** Sync lock — state alone cannot block double-click before re-render */
  const submitLockRef = useRef(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importReport, setImportReport] = useState<ImportReport | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<CsvImportPreview | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [aiRecMap, setAiRecMap] = useState<Record<string, AiFollowupRec>>({});
  const [scoreResult, setScoreResult] = useState<{
    score: number;
    explanation: string;
    leadName: string;
  } | null>(null);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [assignValue, setAssignValue] = useState("");
  /** Assign scope: selected IDs, first N filtered, or all filtered (≤50k) */
  const [assignScope, setAssignScope] = useState<"ids" | "first_n" | "all_filtered">("ids");
  const [assignFirstPreset, setAssignFirstPreset] = useState<
    "100" | "250" | "500" | "1000" | "5000" | "custom"
  >("100");
  const [assignCustomCount, setAssignCustomCount] = useState("");
  const [followUpModalOpen, setFollowUpModalOpen] = useState(false);
  const [followUpTitle, setFollowUpTitle] = useState("Follow up");
  const [followUpDays, setFollowUpDays] = useState("1");
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  /** "selected" = current selection; "all_filtered" = every lead matching search/status */
  const [bulkDeleteScope, setBulkDeleteScope] = useState<"selected" | "all_filtered">("selected");
  const [bulkProgress, setBulkProgress] = useState<string | null>(null);
  /** In-app compose email modal */
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [emailContactIds, setEmailContactIds] = useState<string[]>([]);
  const [emailSending, setEmailSending] = useState(false);
  const [bulkEditForm, setBulkEditForm] = useState({
    status: "",
    assignedTo: "",
    source: "",
    priority: "",
    tags: "",
    company: "",
    customKey: "",
    customValue: "",
  });
  /** Active workspace users for Assign To (id = assignedTo userId) */
  type TeamMemberRow = {
    id: string;
    name: string | null;
    email: string;
    phone?: string | null;
    employeeCode?: string | null;
    username?: string | null;
    isDisabled?: boolean;
  };
  const [teamMembers, setTeamMembers] = useState<TeamMemberRow[]>([]);
  const [teamSearch, setTeamSearch] = useState("");
  /** assignedTo on create/edit form (userId) */
  const [formAssigneeId, setFormAssigneeId] = useState("");
  /** "__all__" = equal distribute to all active members */
  const ALL_MEMBERS_VALUE = "__all__";
  const [assignConfirmOpen, setAssignConfirmOpen] = useState(false);
  const [assignPreview, setAssignPreview] = useState<{
    total: number;
    distribution: Array<{ userId: string; name: string | null; email: string; count: number }>;
    mode: "single" | "all_members";
  } | null>(null);
  const [assignNotes, setAssignNotes] = useState("");
  const [mediaSendLead, setMediaSendLead] = useState<Contact | null>(null);

  const loadConfig = useCallback(async () => {
    if (!token) return;
    const res = await api.getBusinessConfig(token);
    if (res.success && res.data) {
      setBizConfig((res.data.config as BusinessConfigDTO) || null);
      setTemplateSlug(res.data.business?.templateSlug || null);
    }
  }, [token]);

  const loadTeam = useCallback(async () => {
    if (!token) return;
    // Prefer assignable-members (any bulk-editor); fall back to business-users for admins
    const res = await api.listAssignableMembers(token);
    if (res.success && res.data?.members) {
      setTeamMembers(
        res.data.members.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          phone: u.phone,
          employeeCode: u.employeeCode,
          username: u.username,
          isDisabled: false,
        }))
      );
      return;
    }
    const fallback = await api.listBusinessUsers(token);
    if (fallback.success && fallback.data?.users) {
      setTeamMembers(
        fallback.data.users
          .filter((u) => !u.isDisabled && u.status !== "disabled")
          .map((u) => ({
            id: u.id,
            name: u.name,
            email: u.email,
            phone: (u as { phone?: string | null }).phone,
            employeeCode: (u as { employeeCode?: string | null }).employeeCode,
            username: (u as { username?: string | null }).username,
            isDisabled: u.isDisabled,
          }))
      );
    }
  }, [token]);

  const assigneeLabel = useCallback(
    (userId: string | null | undefined) => {
      if (!userId) return "Unassigned";
      const m = teamMembers.find((t) => t.id === userId);
      if (m) return m.name?.trim() || m.email;
      // Legacy free-text values (name/email stored before userId fix)
      if (userId.includes("@") || userId.length < 20) return userId;
      return "Assigned user";
    },
    [teamMembers]
  );

  /** Search by name, email, phone, employee ID, username (partial match) */
  const memberMatchesSearch = useCallback((m: TeamMemberRow, q: string) => {
    if (!q) return true;
    const hay = [
      m.name || "",
      m.email || "",
      m.phone || "",
      m.employeeCode || "",
      m.username || "",
      m.id || "",
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  }, []);

  const filteredTeam = useMemo(() => {
    const q = teamSearch.trim().toLowerCase();
    if (!q) return teamMembers;
    return teamMembers.filter((m) => memberMatchesSearch(m, q));
  }, [teamMembers, teamSearch, memberMatchesSearch]);

  const loadLeads = useCallback(async (opts?: { page?: number; silent?: boolean }) => {
    if (!token) return { ok: false as const, total: 0 };
    if (!opts?.silent) setIsLoading(true);
    const pageNum = opts?.page && opts.page > 0 ? opts.page : page;
    // Server-side pagination (API caps pageSize at 200). Total from server is authoritative.
    const q = new URLSearchParams({
      type: "lead",
      page: String(pageNum),
      pageSize: String(Math.min(200, PAGE_SIZE > 50 ? PAGE_SIZE : 50)),
      sortBy: "updatedAt",
      sortDir: "desc",
    });
    if (search.trim()) q.set("search", search.trim());
    if (statusFilter) q.set("status", statusFilter);

    const apiRes = await api.getCrmContacts(`?${q.toString()}`, token);
    const data = apiRes.data as {
      contacts?: Contact[];
      total?: number;
      page?: number;
      pageSize?: number;
      totalPages?: number;
    } | undefined;
    if (apiRes.success && data?.contacts) {
      setLeads(data.contacts);
      const total =
        typeof data.total === "number" ? data.total : data.contacts.length;
      setServerTotal(total);
      if (typeof data.page === "number" && data.page !== page) {
        setPage(data.page);
      }
      setSelectedIds(new Set());
      // AI map is best-effort — never toast; never block import UX
      const ids = data.contacts.map((c) => c.id);
      if (ids.length) {
        api
          .post<Record<string, AiFollowupRec>>(
            "/crm/ai/followup-engine/map",
            { contactIds: ids },
            token
          )
          .then((r) => {
            if (r.success && r.data) setAiRecMap(r.data);
          })
          .catch(() => {});
      }
      if (!opts?.silent) setIsLoading(false);
      return { ok: true as const, total };
    }

    // List refresh failed — never surface raw "Cannot reach API" on this path
    if (!apiRes.success && !opts?.silent) {
      toast.message("Could not refresh leads list", {
        description: "Reload the page if the table looks out of date.",
      });
    }
    if (!opts?.silent) setIsLoading(false);
    return { ok: false as const, total: serverTotal };
  }, [token, page, search, statusFilter, serverTotal]);

  const fieldDefs: FieldDef[] = useMemo(() => {
    const fromConfig = contactFieldsFromConfig(bizConfig);
    const base = fromConfig.length ? fromConfig : FALLBACK_CONTACT_FIELDS;
    // Always expose Feedback on New/Edit Lead (customFields.feedback)
    return ensureLeadFormFields(base);
  }, [bizConfig]);

  const tableFields = useMemo(() => listFields(fieldDefs), [fieldDefs]);
  const filterableFields = useMemo(() => filterFields(fieldDefs), [fieldDefs]);
  // Always telecalling defaults + config merge (leadStatusesFromConfig never empty)
  const statusOptions: PipelineStatus[] = useMemo(() => {
    const fromConfig = leadStatusesFromConfig(bizConfig);
    return fromConfig.length ? fromConfig : FALLBACK_LEAD_STATUSES;
  }, [bizConfig]);

  const isTransportError = (msg?: string) =>
    !!msg &&
    (/Cannot reach API/i.test(msg) ||
      /timed out|timeout|aborted/i.test(msg) ||
      /offline|Failed to fetch|Network error|network request failed/i.test(msg) ||
      /Import finished but response was not JSON/i.test(msg));

  const applyImportResult = async (
    res: {
      success: boolean;
      error?: string;
      data?: Partial<ImportReport> & { needsMapping?: boolean; mappingPreview?: CsvImportPreview };
    },
    opts?: { totalBefore?: number }
  ) => {
    const data = res.data;
    // Backend asked for mapping wizard
    if (data?.needsMapping && data.mappingPreview) {
      setImportPreview(data.mappingPreview);
      setWizardOpen(true);
      toast.message("Map your columns", {
        description: data.errors?.[0]?.reason || "Confirm how CSV columns map to CRM fields.",
      });
      return;
    }

    const report: ImportReport = {
      parsedRows: data?.parsedRows ?? 0,
      imported: data?.imported ?? 0,
      updated: data?.updated ?? 0,
      skippedDuplicates: data?.skippedDuplicates ?? 0,
      failed: data?.failed ?? 0,
      skippedEmpty: data?.skippedEmpty,
      errors: data?.errors ?? [],
      report: data?.report,
      allowedStatuses: data?.allowedStatuses,
    };
    setImportReport(report);
    setWizardOpen(false);
    setImportFile(null);
    setImportPreview(null);

    const writtenFromApi = report.imported + (report.updated || 0);
    const errorPreview = (report.errors || [])
      .slice(0, 3)
      .map(formatImportError)
      .join(" · ");
    const totalBefore = opts?.totalBefore ?? serverTotal;

    // Always refresh table after import attempt (silent — no error toasts)
    setPage(1);
    const refreshed = await loadLeads({ page: 1, silent: true });
    const totalAfter = refreshed.ok ? refreshed.total : serverTotal;
    const delta =
      Number.isFinite(totalBefore) && Number.isFinite(totalAfter)
        ? Math.max(0, totalAfter - totalBefore)
        : 0;

    // Server wrote rows, but client transport failed (timeout / connection drop after write)
    const recoveredFromTransport =
      !res.success && isTransportError(res.error) && (writtenFromApi > 0 || delta > 0 || refreshed.ok);

    const effectiveWritten =
      writtenFromApi > 0 ? writtenFromApi : recoveredFromTransport && delta > 0 ? delta : writtenFromApi;

    const importSucceeded =
      (res.success && writtenFromApi > 0) ||
      recoveredFromTransport ||
      (writtenFromApi > 0 && isTransportError(res.error));

    if (importSucceeded && (effectiveWritten > 0 || recoveredFromTransport)) {
      const countLabel =
        effectiveWritten > 0
          ? effectiveWritten
          : delta > 0
            ? delta
            : report.imported || report.parsedRows || 0;
      toast.success(
        `${Math.max(countLabel, 1).toLocaleString()} lead${countLabel === 1 ? "" : "s"} imported successfully`,
        {
          description: [
            report.imported ? `${report.imported} created` : null,
            report.updated ? `${report.updated} updated` : null,
            report.parsedRows ? `of ${report.parsedRows} rows` : null,
            report.failed ? `${report.failed} failed` : null,
            report.skippedDuplicates
              ? `${report.skippedDuplicates} duplicates skipped`
              : null,
            recoveredFromTransport && !res.success
              ? "Response dropped after write — table refreshed from server"
              : null,
          ]
            .filter(Boolean)
            .join(" · "),
          duration: 8000,
        }
      );
      // Defer secondary dashboard refresh so it cannot race and toast over import success
      try {
        const { emitDataChanged } = await import("@/lib/data-events");
        emitDataChanged({ module: "contact", action: "import" });
      } catch {
        /* non-fatal */
      }
      return;
    }

    if (res.success && writtenFromApi === 0) {
      toast.message("Import finished with no new rows written", {
        description:
          errorPreview ||
          report.report?.split("\n").slice(0, 4).join(" · ") ||
          "All rows may be duplicates or empty. See Import Report.",
        duration: 10000,
      });
      return;
    }

    // True import failure (validation / auth / server) — never use "Cannot reach API" wording
    if (isTransportError(res.error)) {
      if (refreshed.ok) {
        toast.message("Import response was incomplete", {
          description:
            "The table was refreshed from the server. If new leads are listed, the import succeeded.",
          duration: 10000,
        });
      } else {
        toast.message("Could not confirm import result", {
          description:
            "Reload the Leads page to verify. Large files can finish on the server after the browser times out.",
          duration: 12000,
        });
      }
      return;
    }

    toast.error(res.error || "Import failed", {
      description:
        errorPreview ||
        report.report?.split("\n").slice(0, 4).join(" · ") ||
        "See Import Report for details.",
      duration: 12000,
    });
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !token) return;
    setImporting(true);
    setImportFile(file);
    toast.message(`Analyzing ${file.name}…`);

    const statuses =
      statusOptions.map((s) => s.key).length > 0
        ? statusOptions.map((s) => s.key)
        : ["new", "contacted", "qualified", "proposal", "negotiation", "won", "lost"];

    let preview: CsvImportPreview | null = null;

    // CSV/TSV: map columns in-browser (no full-file upload for preview — avoids proxy timeouts)
    if (isCsvLikeFilename(file.name)) {
      try {
        preview = (await buildClientCsvPreview(file, statuses)) as CsvImportPreview;
      } catch (err) {
        console.warn("[import] client CSV preview failed", err);
      }
    }

    // Excel (or CSV fallback): fast server preview (first ~40 rows only on API)
    if (!preview) {
      const previewRes = await api.previewImportFile(file, token);
      if (previewRes.success && previewRes.data) {
        preview = previewRes.data as CsvImportPreview;
      } else if (isCsvLikeFilename(file.name)) {
        // Last resort: client parse if server preview transport failed
        try {
          preview = (await buildClientCsvPreview(file, statuses)) as CsvImportPreview;
        } catch {
          /* ignore */
        }
      }

      if (!preview) {
        // Preview never commits leads — never claim the server "processed" the file
        const err = previewRes.error || "";
        toast.error(
          err && !/connection interrupted|timed out|Cannot reach|Try CSV/i.test(err)
            ? err
            : "Could not read file headers. Try CSV, or a smaller Excel export.",
          {
            description: "Import was not started. Fix the file and try again.",
          }
        );
        setImporting(false);
        setImportFile(null);
        e.target.value = "";
        return;
      }
    }

    setImportPreview(preview);
    // Always show wizard so user confirms mapping before commit
    setWizardOpen(true);
    setImporting(false);
    e.target.value = "";
  };

  const confirmWizardImport = async (opts: {
    mappings: Array<{ sourceHeader: string; fieldKey: string }>;
    saveMapping: boolean;
    updateExisting: boolean;
  }) => {
    if (!importFile || !token) return;
    setImporting(true);
    toast.message(`Importing ${importFile.name}…`);
    const totalBefore = serverTotal;
    const res = await api.importContactsFile(importFile, token, opts);
    await applyImportResult(
      {
        success: res.success,
        error: res.error,
        data: res.data
          ? {
              ...res.data,
              mappingPreview: res.data.mappingPreview as CsvImportPreview | undefined,
            }
          : undefined,
      },
      { totalBefore }
    );
    setImporting(false);
  };

  const cancelWizard = () => {
    setWizardOpen(false);
    setImportFile(null);
    setImportPreview(null);
  };

  const downloadCsvTemplate = () => {
    const statuses =
      (importReport?.allowedStatuses?.length
        ? importReport.allowedStatuses
        : statusOptions.map((s) => s.key)) || ["new", "qualified", "proposal", "won", "lost"];
    const header = "name,phone,email,company,status,value,source,type,description";
    const sample = [
      `Jane Doe,9876543210,jane@example.com,Acme Corp,${statuses[0] || "new"},,website,lead,Sample lead`,
      `John Smith,9876543211,john@example.com,Beta Inc,${statuses[1] || statuses[0] || "qualified"},5000,referral,lead,`,
    ].join("\n");
    const blob = new Blob([`${header}\n${sample}\n`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "leads-import-template.csv";
    a.click();
    URL.revokeObjectURL(url);
    toast.message("CSV template downloaded", {
      description: `Status must be one of: ${statuses.join(", ")}`,
    });
  };

  useEffect(() => {
    void loadConfig();
    void loadTeam();
  }, [loadConfig, loadTeam]);

  useEffect(() => {
    if (
      showModal ||
      assignModalOpen ||
      followUpModalOpen ||
      bulkEditOpen ||
      bulkDeleteOpen ||
      emailModalOpen
    ) {
      const original = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = original;
      };
    }
  }, [showModal, assignModalOpen, followUpModalOpen, bulkEditOpen, bulkDeleteOpen, emailModalOpen]);

  // Enrich leads with description meta (legacy import) + customFields for filters
  const enriched = useMemo(() => {
    return leads.map((lead) => {
      const meta = parseLeadMeta(lead.description);
      const custom = (lead.customFields || {}) as Record<string, unknown>;
      return {
        ...lead,
        district: (custom.district as string) || meta.district,
        group: (custom.group as string) || meta.group,
      };
    });
  }, [leads]);

  /** Distinct values for a filterable field (from data, not hardcoded industries) */
  const filterOptionsByKey = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const f of filterableFields) {
      if (f.coreMap === "status" || f.key === "status") continue;
      const set = new Set<string>();
      for (const lead of enriched) {
        const v = getContactFieldValue(lead as Record<string, unknown>, f);
        if (v != null && String(v).trim()) set.add(String(v).trim());
      }
      map[f.key] = Array.from(set).sort((a, b) => a.localeCompare(b));
    }
    return map;
  }, [enriched, filterableFields]);

  // Meta filters only on the loaded page; search/status are server-side
  const filteredLeads = useMemo(() => {
    return enriched.filter((lead) =>
      filterableFields.every((f) => {
        if (f.coreMap === "status" || f.key === "status") return true;
        const sel = metaFilters[f.key];
        if (!sel) return true;
        const v = getContactFieldValue(lead as Record<string, unknown>, f);
        return String(v ?? "") === sel;
      })
    );
  }, [enriched, metaFilters, filterableFields]);

  // Reset to first page when search/status change
  useEffect(() => {
    setPage(1);
  }, [search, statusFilter]);

  // Server-driven load (page + search + status)
  useEffect(() => {
    if (!token) return;
    void loadLeads({ page });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, page, search, statusFilter]);

  const pageSizeUsed = Math.min(200, PAGE_SIZE > 50 ? PAGE_SIZE : 50);
  const totalFiltered = serverTotal;
  const totalPages = Math.max(1, Math.ceil(Math.max(serverTotal, 1) / pageSizeUsed));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const pageStart = (safePage - 1) * pageSizeUsed;
  // Current page rows come from the API (already paginated)
  const pageLeads = filteredLeads;

  const allPageSelected =
    pageLeads.length > 0 && pageLeads.every((l) => selectedIds.has(l.id));
  const somePageSelected = pageLeads.some((l) => selectedIds.has(l.id));

  const toggleSelectAllPage = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allPageSelected) {
        pageLeads.forEach((l) => next.delete(l.id));
      } else {
        pageLeads.forEach((l) => next.add(l.id));
      }
      return next;
    });
  };

  /** Select only rows on the current page (client-visible set). */
  const selectCurrentPage = () => {
    setSelectedIds(new Set(pageLeads.map((l) => l.id)));
  };

  const allResultsSelected =
    pageLeads.length > 0 &&
    pageLeads.every((l) => selectedIds.has(l.id)) &&
    selectedIds.size === pageLeads.length;

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const selectedLeads = useMemo(
    () => enriched.filter((l) => selectedIds.has(l.id)),
    [enriched, selectedIds]
  );

  const roleKey = (role || "").toLowerCase();
  const canBulkEdit =
    !roleKey ||
    [
      "ceo",
      "owner",
      "business_admin",
      "admin",
      "sales_manager",
      "manager",
      "super_admin",
      "sales_executive",
    ].includes(roleKey);
  /** Sales Manager: edit only. Sales Executive: no delete unless elevated role. */
  const canBulkDelete = ["ceo", "owner", "business_admin", "admin", "super_admin"].includes(roleKey);

  const handleFormChange = (key: string, value: unknown) => {
    setFormValues((prev) => ({ ...prev, [key]: value }));
  };

  const openCreate = () => {
    setEditingLead(null);
    setFormValues(contactToFormValues(fieldDefs, { status: statusOptions[0]?.key || "new" }));
    setFormAssigneeId("");
    setTeamSearch("");
    setShowModal(true);
  };

  const openEdit = (lead: Contact) => {
    setEditingLead(lead);
    setFormValues(contactToFormValues(fieldDefs, lead as Record<string, unknown>));
    // Prefer userId match; legacy free-text names map if possible
    const raw = lead.assignedTo || "";
    const byId = teamMembers.find((t) => t.id === raw);
    const byName = teamMembers.find(
      (t) =>
        (t.name && t.name === raw) ||
        t.email === raw ||
        (t.name && raw && t.name.toLowerCase() === raw.toLowerCase())
    );
    setFormAssigneeId(byId?.id || byName?.id || (raw.length > 20 ? raw : ""));
    setTeamSearch("");
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingLead(null);
    setFormAssigneeId("");
    setTeamSearch("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Guard before setState — blocks double-click / double-submit races
    if (!token || isSubmitting || submitLockRef.current) return;

    const payload = buildContactPayload(fieldDefs, formValues, "lead");
    if (!payload.name || !String(payload.name).trim()) {
      toast.error("Name is required");
      return;
    }
    // Always store userId (or null), never free-text name/email
    payload.assignedTo = formAssigneeId.trim() || null;

    submitLockRef.current = true;
    setIsSubmitting(true);
    try {
      const apiResponse = editingLead
        ? await api.updateCrmContact(editingLead.id, payload, token)
        : await api.createCrmContact(payload, token);

      if (apiResponse.success) {
        const sync = (
          apiResponse.data as {
            pipelineSync?: {
              dealCreated?: boolean;
              dealsUpdated?: number;
              contactConvertedToClient?: boolean;
              promptCreateDeal?: boolean;
              messages?: string[];
            } | null;
          } | undefined
        )?.pipelineSync;

        let msg: string = editingLead ? SuccessMsg.leadUpdated : SuccessMsg.leadCreated;
        if (sync?.contactConvertedToClient) msg = "Lead won — converted to Client";
        else if (sync?.dealCreated) msg = "Lead updated — deal created & pipeline synced";
        else if (sync?.dealsUpdated) msg = `Lead updated — ${sync.dealsUpdated} deal(s) synced`;
        toast.success(msg);
        if (sync?.messages?.length) {
          toast.message(sync.messages.slice(0, 2).join(" · "), { duration: 5000 });
        }
        if (sync?.promptCreateDeal) {
          toast.message("No linked deal. Create one from Deals, or enable auto-create in business settings.", {
            duration: 7000,
          });
        }
        closeModal();
        const { emitDataChanged } = await import("@/lib/data-events");
        // One consolidated refresh — avoids 4× notification/media fan-out from DashboardShell
        emitDataChanged({ module: "all", action: editingLead ? "update" : "create" });
        await loadLeads();
      } else {
        toast.error(friendlyError(apiResponse.error, "Could not save lead. Please try again."));
      }
    } finally {
      submitLockRef.current = false;
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!token) return;
    if (!confirm(`Move lead "${name}" to trash? You can restore later from bulk undo when available.`)) return;
    const response = await api.deleteCrmContact(id, token);
    if (response.success) {
      toast.success("Lead moved to trash");
      const { emitDataChanged } = await import("@/lib/data-events");
      emitDataChanged({ module: "contact", action: "delete" });
      emitDataChanged({ module: "notification", action: "refresh" });
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      await loadLeads();
    } else {
      toast.error(response.error || "Failed to delete");
    }
  };

  const scoreLead = async (lead: Contact, silent = false) => {
    if (!token) return null;
    try {
      const res = await api.post(`/crm/ai/lead-score`, { contactId: lead.id }, token);
      if (res.success && res.data) {
        const data = res.data as { score?: number; explanation?: string };
        const score = data.score ?? 0;
        setLeads((prev) => prev.map((l) => (l.id === lead.id ? { ...l, aiScore: score } : l)));
        if (!silent) {
          toast.success(`Lead scored: ${score}`, {
            description: data.explanation || "",
            duration: 6000,
          });
          setScoreResult({
            score,
            explanation: data.explanation || "No detailed reason provided.",
            leadName: lead.name,
          });
        }
        return score;
      }
      if (!silent) toast.error(res.error || "Failed to score lead");
      return null;
    } catch {
      if (!silent) toast.error("Failed to score lead");
      return null;
    }
  };

  // ——— Bulk actions (UI orchestration over existing endpoints) ———

  const BULK_ASSIGN_MAX = 50_000;

  const resolvedAssignLimit = useMemo(() => {
    if (assignScope !== "first_n") return null;
    if (assignFirstPreset === "custom") {
      const n = Number.parseInt(assignCustomCount, 10);
      return Number.isFinite(n) ? n : NaN;
    }
    return Number.parseInt(assignFirstPreset, 10);
  }, [assignScope, assignFirstPreset, assignCustomCount]);

  const assignCustomValidation = useMemo(() => {
    if (assignScope !== "first_n" || assignFirstPreset !== "custom") return null;
    if (!assignCustomCount.trim()) return "Enter a number between 1 and 50,000.";
    const n = Number.parseInt(assignCustomCount, 10);
    if (!Number.isFinite(n) || String(n) !== assignCustomCount.trim()) {
      return "Enter a whole number between 1 and 50,000.";
    }
    if (n < 1) return "Count must be at least 1.";
    if (n > BULK_ASSIGN_MAX) return "Count cannot exceed 50,000.";
    if (n > serverTotal) {
      return `Count cannot exceed filtered results (${serverTotal.toLocaleString()}).`;
    }
    return null;
  }, [assignScope, assignFirstPreset, assignCustomCount, serverTotal]);

  const buildAssignBody = (dryRun: boolean) => {
    const isAll = assignValue === ALL_MEMBERS_VALUE;
    const member = isAll ? null : teamMembers.find((t) => t.id === assignValue.trim());
    const base = {
      assignMode: (isAll ? "all_members" : "single") as "all_members" | "single",
      assignedTo: isAll ? undefined : member?.id,
      notes: assignNotes.trim() || undefined,
      dryRun,
    };
    if (assignScope === "ids") {
      return { ...base, scope: "ids" as const, ids: [...selectedIds] };
    }
    if (assignScope === "all_filtered") {
      return {
        ...base,
        scope: "all_filtered" as const,
        search: search.trim() || undefined,
        status: statusFilter || undefined,
      };
    }
    return {
      ...base,
      scope: "first_n" as const,
      limit: Math.min(resolvedAssignLimit || 0, serverTotal, BULK_ASSIGN_MAX),
      search: search.trim() || undefined,
      status: statusFilter || undefined,
    };
  };

  const validateAssignForm = (): string | null => {
    if (!assignValue.trim()) return "Select a team member or All Members";
    if (assignValue !== ALL_MEMBERS_VALUE) {
      const member = teamMembers.find((t) => t.id === assignValue.trim());
      if (!member) return "Select a team member from the list";
    } else if (teamMembers.length === 0) {
      return "No active members to distribute leads";
    }
    if (assignScope === "ids" && selectedIds.size === 0) return "Select at least one lead";
    if (assignScope === "all_filtered" && serverTotal === 0) {
      return "No leads match the current filters";
    }
    if (assignScope === "first_n") {
      if (assignFirstPreset === "custom" && assignCustomValidation) return assignCustomValidation;
      const lim = resolvedAssignLimit;
      if (!lim || !Number.isFinite(lim) || lim < 1) return "Enter a valid count between 1 and 50,000";
      if (lim > BULK_ASSIGN_MAX) return "Count cannot exceed 50,000";
      if (serverTotal === 0) return "No leads match the current filters";
    }
    return null;
  };

  /** Step 1: dry-run preview → confirmation dialog */
  const requestAssignPreview = async () => {
    if (!token) return;
    const err = validateAssignForm();
    if (err) {
      toast.error(err);
      return;
    }
    setBulkBusy(true);
    setBulkProgress("Calculating distribution…");
    try {
      const res = await api.bulkAssignLeads(buildAssignBody(true), token);
      if (res.success && res.data?.distribution) {
        const total = res.data.distribution.reduce((s, d) => s + d.count, 0);
        setAssignPreview({
          total: total || res.data.requested || 0,
          distribution: res.data.distribution,
          mode: assignValue === ALL_MEMBERS_VALUE ? "all_members" : "single",
        });
        setAssignConfirmOpen(true);
      } else {
        toast.error(res.error || "Could not preview assignment");
      }
    } finally {
      setBulkBusy(false);
      setBulkProgress(null);
    }
  };

  /** Step 2: confirmed execute */
  const runBulkAssign = async () => {
    if (!token) return;
    const err = validateAssignForm();
    if (err) {
      toast.error(err);
      return;
    }

    const isAll = assignValue === ALL_MEMBERS_VALUE;
    const member = isAll ? null : teamMembers.find((t) => t.id === assignValue.trim());
    const label = isAll
      ? `All members (${teamMembers.length})`
      : member?.name?.trim() || member?.email || "member";

    const progressHint =
      assignScope === "ids"
        ? `Assigning ${selectedIds.size.toLocaleString()} selected lead(s)…`
        : assignScope === "all_filtered"
          ? `Assigning all ${serverTotal.toLocaleString()} filtered lead(s)…`
          : `Assigning first ${Math.min(resolvedAssignLimit || 0, serverTotal).toLocaleString()} filtered lead(s)…`;

    setBulkBusy(true);
    setBulkProgress(progressHint);

    try {
      const res = await api.bulkAssignLeads(buildAssignBody(false), token);
      if (res.success && res.data) {
        const n = res.data.assigned;
        let msg = `Successfully assigned ${n.toLocaleString()} leads.`;
        if (res.data.scope === "first_n") {
          msg = `Successfully assigned first ${n.toLocaleString()} filtered leads.`;
        } else if (res.data.scope === "all_filtered") {
          msg = `Successfully assigned all ${n.toLocaleString()} filtered leads.`;
        }
        if (res.data.mode === "all_members" || isAll) {
          msg = `Successfully distributed ${n.toLocaleString()} leads equally among ${res.data.distribution?.length ?? teamMembers.length} members.`;
        }
        const seq =
          res.data.sequence != null ? `Assignment #${res.data.sequence}` : "Saved to history";
        toast.success(msg, {
          description: `${label} · ${seq}${res.data.failed ? ` · ${res.data.failed} failed` : ""}`,
        });
        setAssignConfirmOpen(false);
        setAssignPreview(null);
        setAssignModalOpen(false);
        setAssignValue("");
        setTeamSearch("");
        setAssignCustomCount("");
        setAssignNotes("");
        clearSelection();
        await loadLeads();
        const { emitDataChanged } = await import("@/lib/data-events");
        emitDataChanged({ module: "contact", action: "update" });
      } else {
        toast.error(res.error || "Bulk assign failed");
      }
    } finally {
      setBulkBusy(false);
      setBulkProgress(null);
    }
  };

  const runBulkAiScore = async () => {
    if (!token || selectedLeads.length === 0) return;
    const max = 25;
    const batch = selectedLeads.slice(0, max);
    if (selectedLeads.length > max) {
      toast.message(`Scoring first ${max} of ${selectedLeads.length} selected (rate-limit safe)`);
    }
    setBulkBusy(true);
    let ok = 0;
    for (const lead of batch) {
      const score = await scoreLead(lead, true);
      if (score != null) ok++;
    }
    setBulkBusy(false);
    toast.success(`AI scored ${ok}/${batch.length} lead(s)`);
    clearSelection();
  };

  const runBulkWhatsApp = () => {
    const withPhone = selectedLeads.filter((l) => digitsOnly(l.phone).length >= 10);
    if (withPhone.length === 0) {
      toast.error("No selected leads have a valid phone number");
      return;
    }
    // Open first chat; copy all numbers for the rest
    const first = digitsOnly(withPhone[0].phone);
    const waNum = first.length > 10 ? first.slice(-10) : first;
    window.open(`https://wa.me/91${waNum}`, "_blank", "noopener,noreferrer");
    if (withPhone.length > 1) {
      const list = withPhone
        .map((l) => `${l.name}: ${l.phone}`)
        .join("\n");
      navigator.clipboard.writeText(list).then(
        () =>
          toast.success(`Opened WhatsApp for ${withPhone[0].name}`, {
            description: `${withPhone.length - 1} more number(s) copied to clipboard`,
          }),
        () => toast.success(`Opened WhatsApp for ${withPhone[0].name}`)
      );
    } else {
      toast.success(`Opened WhatsApp for ${withPhone[0].name}`);
    }
  };

  const openEmailCompose = (leadsToEmail: Contact[]) => {
    const withEmail = leadsToEmail.filter((l) => l.email && String(l.email).includes("@"));
    if (withEmail.length === 0) {
      toast.error("No valid email address on the selected lead(s)");
      return;
    }
    const ids = withEmail.map((l) => l.id);
    const first = withEmail[0];
    setEmailContactIds(ids);
    setEmailTo(
      withEmail.length === 1
        ? String(first.email)
        : withEmail.map((l) => String(l.email)).join(", ")
    );
    setEmailSubject(
      withEmail.length === 1
        ? `Following up — ${first.name}`
        : `Following up with ${withEmail.length} contacts`
    );
    setEmailBody(
      withEmail.length === 1
        ? `Hi ${first.name},\n\n`
        : `Hi,\n\n`
    );
    setEmailModalOpen(true);
  };

  const runBulkEmail = () => {
    openEmailCompose(selectedLeads);
  };

  const isValidEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

  const sendComposedEmail = async () => {
    if (!token) return;
    const subject = emailSubject.trim();
    const body = emailBody.trim();
    if (!subject) {
      toast.error("Subject is required");
      return;
    }
    if (!body) {
      toast.error("Email body is required");
      return;
    }
    // Single recipient: validate To field; multi: send per contact with their own email
    const singleTo =
      emailContactIds.length === 1 ? emailTo.split(",")[0]?.trim() || undefined : undefined;
    if (emailContactIds.length === 1 && singleTo && !isValidEmail(singleTo)) {
      toast.error("Enter a valid recipient email address");
      return;
    }
    if (emailContactIds.length > 1) {
      // Multi: To field is display-only list; each lead uses stored email
    }
    setEmailSending(true);
    const res = await api.sendLeadEmail(
      {
        contactIds: emailContactIds,
        to: singleTo,
        subject,
        body,
      },
      token
    );
    setEmailSending(false);
    if (res.success && res.data) {
      toast.success(
        res.data.sent === 1
          ? "Email sent successfully"
          : `Sent ${res.data.sent} email(s)`,
        {
          description: res.data.failed
            ? `${res.data.failed} failed`
            : undefined,
        }
      );
      setEmailModalOpen(false);
    } else {
      toast.error(res.error || "Failed to send email");
    }
  };

  const runBulkFollowUp = async () => {
    if (!token || selectedLeads.length === 0) return;
    setBulkBusy(true);
    setBulkProgress("Creating follow-ups…");
    const days = Math.max(0, parseInt(followUpDays, 10) || 1);
    const due = new Date();
    due.setDate(due.getDate() + days);
    let ok = 0;
    let fail = 0;
    for (const lead of selectedLeads) {
      const res = await api.createCrmTask(
        {
          contactId: lead.id,
          title: `${followUpTitle.trim() || "Follow up"}: ${lead.name}`,
          description: `Bulk follow-up for ${lead.name}${lead.phone ? ` (${lead.phone})` : ""}`,
          dueDate: due.toISOString(),
          status: "todo",
          priority: "medium",
        },
        token
      );
      if (res.success) ok++;
      else fail++;
    }
    setBulkBusy(false);
    setBulkProgress(null);
    setFollowUpModalOpen(false);
    if (ok) toast.success(`Created ${ok} follow-up task(s)`);
    if (fail) toast.error(`${fail} follow-up(s) failed`);
    clearSelection();
  };

  const runBulkExport = () => {
    if (selectedLeads.length === 0) return;
    // RFC 4180 CSV + UTF-8 BOM for Excel compatibility
    const headers = [
      "Name",
      "Email",
      "Phone",
      "Company",
      "Status",
      "Source",
      "Priority",
      "AssignedTo",
      "Tags",
      "AI Score",
    ];
    const esc = (v: unknown) => {
      let s = v == null ? "" : String(v);
      s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      if (/^[=+\-@\t]/.test(s)) s = `'${s}`;
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const lines = [headers.map(esc).join(",")];
    for (const l of selectedLeads) {
      const cells = [
        l.name,
        l.email,
        l.phone,
        l.company,
        l.status,
        l.source,
        l.priority,
        l.assignedTo,
        Array.isArray(l.tags) ? (l.tags as string[]).join(";") : "",
        l.aiScore,
      ];
      // Pad to header count
      while (cells.length < headers.length) cells.push("");
      lines.push(cells.slice(0, headers.length).map(esc).join(","));
    }
    const bom = "\uFEFF";
    const blob = new Blob([bom + lines.join("\r\n") + "\r\n"], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `leads-export-${selectedLeads.length}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${selectedLeads.length} lead(s) as CSV`);
  };

  const runBulkEdit = async () => {
    if (!token || selectedLeads.length === 0 || !canBulkEdit) return;
    const patch: Record<string, unknown> = {};
    if (bulkEditForm.status.trim()) patch.status = bulkEditForm.status.trim();
    if (bulkEditForm.assignedTo.trim()) {
      patch.assignedTo =
        bulkEditForm.assignedTo === "__unassign__" ? null : bulkEditForm.assignedTo.trim();
    }
    if (bulkEditForm.source.trim()) patch.source = bulkEditForm.source.trim();
    if (bulkEditForm.priority.trim()) patch.priority = bulkEditForm.priority.trim();
    if (bulkEditForm.company.trim()) patch.company = bulkEditForm.company.trim();
    if (bulkEditForm.tags.trim()) {
      patch.tags = bulkEditForm.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
    }
    if (bulkEditForm.customKey.trim()) {
      patch.customFields = {
        [bulkEditForm.customKey.trim()]: bulkEditForm.customValue,
      };
    }
    if (Object.keys(patch).length === 0) {
      toast.error("Choose at least one field to update");
      return;
    }
    setBulkBusy(true);
    setBulkProgress(`Updating ${selectedIds.size} lead(s)…`);
    const res = await api.bulkEditLeads({ ids: [...selectedIds], patch }, token);
    setBulkBusy(false);
    setBulkProgress(null);
    setBulkEditOpen(false);
    if (res.success && res.data) {
      toast.success(`Updated ${res.data.updated} lead(s)`, {
        description: res.data.failed ? `${res.data.failed} failed` : "Audit log recorded",
      });
      clearSelection();
      await loadLeads();
      const { emitDataChanged } = await import("@/lib/data-events");
      // One consolidated refresh (same as single Lead save)
      emitDataChanged({ module: "all", action: "update" });
    } else {
      toast.error(res.error || "Bulk edit failed");
    }
  };

  const runBulkDelete = async () => {
    if (!token || !canBulkDelete) return;
    if (bulkDeleteScope === "selected" && selectedIds.size === 0) {
      toast.error("Select at least one lead");
      return;
    }
    setBulkBusy(true);
    const countLabel =
      bulkDeleteScope === "all_filtered"
        ? serverTotal.toLocaleString()
        : String(selectedIds.size);
    setBulkProgress(`Moving ${countLabel} lead(s) to trash…`);

    const res =
      bulkDeleteScope === "all_filtered"
        ? await api.bulkDeleteLeads(
            {
              scope: "all_filtered",
              search: search.trim() || undefined,
              status: statusFilter || undefined,
              permanent: false,
            },
            token
          )
        : await api.bulkDeleteLeads(
            { ids: [...selectedIds], permanent: false, scope: "ids" },
            token
          );

    setBulkBusy(false);
    setBulkProgress(null);
    setBulkDeleteOpen(false);
    if (res.success && res.data) {
      const restoreIds = res.data.ids || [];
      const canUndo =
        bulkDeleteScope === "selected" && restoreIds.length > 0 && restoreIds.length <= 500;
      toast.success(`Moved ${res.data.deleted.toLocaleString()} lead(s) to trash`, {
        description:
          bulkDeleteScope === "all_filtered"
            ? `All filtered results (${(res.data.matched ?? res.data.deleted).toLocaleString()} matched)`
            : canUndo
              ? "Undo available for a short time"
              : undefined,
        duration: canUndo ? 12000 : 5000,
        action: canUndo
          ? {
              label: "Undo",
              onClick: () => {
                void (async () => {
                  const r = await api.bulkRestoreLeads({ ids: restoreIds }, token);
                  if (r.success) {
                    toast.success(`Restored ${r.data?.restored ?? restoreIds.length} lead(s)`);
                    await loadLeads();
                  } else toast.error(r.error || "Restore failed");
                })();
              },
            }
          : undefined,
      });
      clearSelection();
      await loadLeads();
      const { emitDataChanged } = await import("@/lib/data-events");
      emitDataChanged({ module: "contact", action: "delete" });
    } else {
      toast.error(res.error || "Bulk delete failed");
    }
  };

  const inputClass =
    "bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-border w-full min-w-0";
  const selectClass = `${inputClass} appearance-none`;

  return (
    <div className="w-full max-w-7xl mx-auto px-3 sm:px-5 md:px-6 lg:px-8 pt-4 sm:pt-6 lg:pt-8 pb-4 sm:pb-6 overflow-x-hidden min-w-0 flex flex-col gap-0">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between mb-5 sm:mb-6 gap-3 shrink-0">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Leads</h1>
          <p className="text-muted-foreground mt-1.5 text-sm sm:text-base">
            Manage your sales leads and prospects.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:flex sm:items-center gap-2 w-full sm:w-auto">
          <button
            type="button"
            onClick={downloadCsvTemplate}
            className="min-h-11 px-4 sm:px-5 py-2.5 bg-white/5 border border-border rounded-xl text-sm font-medium hover:bg-white/10 transition-colors text-muted-foreground touch-manipulation"
            title="Download a CSV with headers that match the backend schema"
          >
            CSV template
          </button>
          <label
            className={`min-h-11 px-4 sm:px-5 py-2.5 bg-white/10 rounded-xl text-sm font-medium cursor-pointer hover:bg-white/15 transition-colors text-center flex items-center justify-center touch-manipulation ${
              importing ? "opacity-50 pointer-events-none" : ""
            }`}
          >
            {importing ? "Importing…" : "Import CSV / Excel"}
            <input
              type="file"
              accept=".csv,.tsv,.xlsx,.xls,.xlsm,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              className="hidden"
              disabled={importing}
              onChange={handleImportFile}
            />
          </label>
          <button
            type="button"
            onClick={openCreate}
            className="min-h-11 px-4 sm:px-5 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary-hover transition-colors touch-manipulation"
          >
            + New Lead
          </button>
        </div>
      </div>

      {/* Total + optional import summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <div className="bg-card border border-border rounded-2xl p-4 col-span-1">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Total Leads</div>
          <div className="text-2xl font-semibold tabular-nums text-foreground">
            {isLoading ? "—" : serverTotal.toLocaleString()}
          </div>
          {!isLoading && (
            <div className="text-xs text-muted-foreground mt-1">
              {leads.length < serverTotal
                ? `Showing ${leads.length.toLocaleString()} of ${serverTotal.toLocaleString()}`
                : totalFiltered !== serverTotal
                  ? `${totalFiltered.toLocaleString()} match filters`
                  : "All leads in workspace"}
            </div>
          )}
        </div>

        {importReport && (
          <>
            <div className="bg-card border border-border rounded-2xl p-4">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
                Parsed rows
              </div>
              <div className="text-2xl font-semibold tabular-nums">
                {importReport.parsedRows.toLocaleString()}
              </div>
            </div>
            <div className="bg-card border border-emerald-900/40 rounded-2xl p-4">
              <div className="text-[11px] uppercase tracking-wider text-emerald-500/80 mb-1">
                Imported
              </div>
              <div className="text-2xl font-semibold tabular-nums text-emerald-400">
                {importReport.imported.toLocaleString()}
              </div>
            </div>
            <div className="bg-card border border-sky-900/40 rounded-2xl p-4">
              <div className="text-[11px] uppercase tracking-wider text-sky-400/80 mb-1">
                Updated existing
              </div>
              <div className="text-2xl font-semibold tabular-nums text-sky-400">
                {(importReport.updated ?? 0).toLocaleString()}
              </div>
            </div>
            <div className="bg-card border border-amber-900/40 rounded-2xl p-4">
              <div className="text-[11px] uppercase tracking-wider text-amber-500/80 mb-1">
                Duplicates skipped
              </div>
              <div className="text-2xl font-semibold tabular-nums text-amber-400">
                {importReport.skippedDuplicates.toLocaleString()}
              </div>
            </div>
            <div className="bg-card border border-red-900/40 rounded-2xl p-4">
              <div className="text-[11px] uppercase tracking-wider text-red-400/80 mb-1">
                Failed rows
              </div>
              <div className="text-2xl font-semibold tabular-nums text-red-400">
                {importReport.failed.toLocaleString()}
              </div>
            </div>
          </>
        )}
      </div>

      {importReport && (
        <div className="mb-6 border border-border rounded-2xl bg-background/80 p-4 space-y-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Import report</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {importReport.imported + (importReport.updated || 0) > 0
                  ? `${importReport.imported} created, ${importReport.updated ?? 0} updated in the database.`
                  : "No rows were written. Fix issues below or re-map columns."}
                {importReport.allowedStatuses?.length ? (
                  <>
                    {" "}
                    Status auto-normalized to:{" "}
                    <span className="text-muted-foreground font-mono">
                      {importReport.allowedStatuses.join(", ")}
                    </span>
                  </>
                ) : null}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setImportReport(null)}
              className="text-xs text-muted-foreground hover:text-muted-foreground shrink-0"
            >
              Dismiss
            </button>
          </div>

          {importReport.errors && importReport.errors.length > 0 ? (
            <div className="max-h-56 overflow-auto space-y-2 bg-card border border-border rounded-xl p-3">
              {importReport.errors.map((err, i) => (
                <div
                  key={`${err.row}-${err.column || "x"}-${i}`}
                  className="text-sm border-b border-border/60 last:border-0 pb-2 last:pb-0"
                >
                  <div className="font-mono text-red-300/90 leading-snug">
                    {formatImportError(err)}
                    {err.column ? (
                      <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                        [{err.column}]
                      </span>
                    ) : null}
                  </div>
                  {err.suggestedFix && (
                    <div className="text-xs text-emerald-400/80 mt-0.5">
                      Suggested fix: {err.suggestedFix}
                    </div>
                  )}
                  {err.detectedColumns && err.detectedColumns.length > 0 && (
                    <div className="text-[11px] text-muted-foreground mt-0.5 font-mono">
                      Detected columns: {err.detectedColumns.join(", ")}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : importReport.imported + (importReport.updated || 0) > 0 ? (
            <p className="text-sm text-emerald-400">All usable rows imported or updated successfully.</p>
          ) : null}

          {importReport.report && (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer hover:text-muted-foreground">Full report text</summary>
              <pre className="mt-2 whitespace-pre-wrap font-mono bg-card rounded-lg p-3 max-h-40 overflow-auto text-muted-foreground">
                {importReport.report}
              </pre>
            </details>
          )}
        </div>
      )}

      {importPreview && (
        <CsvImportWizard
          open={wizardOpen}
          filename={importFile?.name || "upload.csv"}
          preview={importPreview}
          busy={importing}
          onCancel={cancelWizard}
          onConfirm={confirmWizardImport}
        />
      )}

      <ExportFiltersBar
        module="leads"
        token={token}
        search={search}
        onSearchChange={setSearch}
        status={statusFilter}
        onStatusChange={setStatusFilter}
        statusOptions={statusOptions.map((s) => ({ value: s.key, label: s.label }))}
        className="mb-4"
      />

      {urlFiltersApplied && (search || statusFilter) && (
        <div className="mb-3 rounded-xl border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-xs text-violet-200 flex flex-wrap items-center gap-2">
          <span>
            Filtered from analytics
            {statusFilter ? ` · status: ${statusFilter}` : ""}
            {search ? ` · search: ${search}` : ""}
          </span>
          <button
            type="button"
            className="underline text-violet-300 hover:text-foreground"
            onClick={() => {
              setSearch("");
              setStatusFilter("");
              setUrlFiltersApplied(false);
            }}
          >
            Clear
          </button>
        </div>
      )}

      {/* Filters — status + config-driven filter fields */}
      <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3 mb-4 items-stretch sm:items-center">
        {templateSlug && (
          <span className="text-xs px-2.5 py-1 rounded-full bg-white/5 border border-border text-muted-foreground w-fit">
            Template: {templateSlug}
          </span>
        )}
        <input
          type="search"
          placeholder="Search name, phone, email, custom fields…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={`${inputClass} flex-1 w-full sm:min-w-[180px] sm:max-w-md min-h-11 text-base sm:text-sm`}
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className={`${selectClass} w-full sm:w-auto sm:min-w-[140px] min-h-11 text-base sm:text-sm`}
          aria-label="Filter by status"
        >
          <option value="">All Statuses</option>
          {statusOptions.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        {filterableFields
          .filter((f) => f.coreMap !== "status" && f.key !== "status")
          .slice(0, 4)
          .map((f) => (
            <select
              key={f.key}
              value={metaFilters[f.key] || ""}
              onChange={(e) =>
                setMetaFilters((prev) => ({ ...prev, [f.key]: e.target.value }))
              }
              className={`${selectClass} w-full sm:w-auto sm:min-w-[140px] min-h-11 text-base sm:text-sm`}
              aria-label={`Filter by ${f.label}`}
            >
              <option value="">All {f.label}</option>
              {(filterOptionsByKey[f.key] || []).map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          ))}
      </div>

      {/* Enterprise sticky bulk toolbar */}
      {selectedIds.size > 0 && (
        <div className="mb-4 sticky z-20 bg-card/98 backdrop-blur-md border border-border rounded-2xl p-3 shadow-xl shadow-black/50 space-y-3 top-[var(--mm-chrome-h,6.5rem)]">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
            <div className="text-sm text-muted-foreground shrink-0 flex flex-wrap items-center gap-2">
              <span className="font-semibold text-foreground tabular-nums px-2 py-1 rounded-lg bg-white/10">
                {selectedIds.size} selected
              </span>
              <button
                type="button"
                onClick={toggleSelectAllPage}
                className="text-xs px-2.5 py-1.5 rounded-lg bg-white/5 border border-border hover:bg-white/10"
              >
                {allPageSelected ? "Deselect page" : "Select page"}
              </button>
              <button
                type="button"
                onClick={selectCurrentPage}
                disabled={allResultsSelected}
                className="text-xs px-2.5 py-1.5 rounded-lg bg-white/5 border border-border hover:bg-white/10 disabled:opacity-40"
              >
                Select this page ({pageLeads.length})
              </button>
              {serverTotal > pageLeads.length && (
                <span className="text-xs text-amber-300/90">
                  {serverTotal.toLocaleString()} match filters — use Assign / Delete → filtered scopes (up to 50,000)
                </span>
              )}
              <button
                type="button"
                onClick={clearSelection}
                className="text-xs text-muted-foreground hover:text-muted-foreground underline px-1"
              >
                Clear selection
              </button>
            </div>
            {bulkProgress && (
              <div className="flex items-center gap-2 text-xs text-sky-300 sm:ml-auto">
                <span className="inline-block w-3.5 h-3.5 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
                {bulkProgress}
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={bulkBusy}
              onClick={() => {
                setAssignValue("");
                setTeamSearch("");
                setAssignScope(selectedIds.size > 0 ? "ids" : "first_n");
                setAssignFirstPreset("100");
                setAssignCustomCount("");
                void loadTeam();
                setAssignModalOpen(true);
              }}
              className="min-h-9 px-3 py-1.5 text-xs rounded-lg bg-white/10 hover:bg-white/15 border border-white/10 disabled:opacity-50"
            >
              Assign User
            </button>
            {canBulkEdit && (
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => {
                  setBulkEditForm({
                    status: "",
                    assignedTo: "",
                    source: "",
                    priority: "",
                    tags: "",
                    company: "",
                    customKey: "",
                    customValue: "",
                  });
                  setBulkEditOpen(true);
                }}
                className="min-h-9 px-3 py-1.5 text-xs rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-medium border border-sky-500 disabled:opacity-50"
              >
                Bulk Edit
              </button>
            )}
            <button
              type="button"
              disabled={bulkBusy}
              onClick={runBulkAiScore}
              className="min-h-9 px-3 py-1.5 text-xs rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 disabled:opacity-50"
            >
              AI Score
            </button>
            <button
              type="button"
              disabled={bulkBusy}
              onClick={runBulkWhatsApp}
              className="min-h-9 px-3 py-1.5 text-xs rounded-lg bg-green-500/10 hover:bg-green-500/20 text-green-400 border border-green-500/30 disabled:opacity-50"
            >
              WhatsApp
            </button>
            <button
              type="button"
              disabled={bulkBusy}
              onClick={runBulkEmail}
              className="min-h-9 px-3 py-1.5 text-xs rounded-lg bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 border border-sky-500/30 disabled:opacity-50"
            >
              Email
            </button>
            <button
              type="button"
              disabled={bulkBusy}
              onClick={() => {
                setFollowUpTitle("Follow up");
                setFollowUpDays("1");
                setFollowUpModalOpen(true);
              }}
              className="min-h-9 px-3 py-1.5 text-xs rounded-lg bg-violet-500/10 hover:bg-violet-500/20 text-violet-300 border border-violet-500/30 disabled:opacity-50"
            >
              Create Follow-up
            </button>
            <button
              type="button"
              disabled={bulkBusy}
              onClick={runBulkExport}
              className="min-h-9 px-3 py-1.5 text-xs rounded-lg bg-white/10 hover:bg-white/15 border border-white/10 disabled:opacity-50"
            >
              Export
            </button>
            {canBulkDelete && (
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => {
                  setBulkDeleteScope("selected");
                  setBulkDeleteOpen(true);
                }}
                className="min-h-9 px-3 py-1.5 text-xs rounded-lg bg-red-600 hover:bg-red-500 text-white font-medium border border-red-500 disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
                Delete
              </button>
            )}
          </div>
        </div>
      )}

      {/* List — natural height only (no forced min-h / stretch that leaves blank space) */}
      {isLoading ? (
        <div className="bg-card border border-border rounded-2xl p-6 shrink-0 space-y-3" aria-busy="true" aria-label="Loading leads">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="mm-skeleton h-12 w-full rounded-xl" />
          ))}
        </div>
      ) : filteredLeads.length === 0 ? (
        <div className="mm-empty bg-card border border-border rounded-2xl shrink-0" role="status">
          <div className="mm-empty-icon" aria-hidden>
            <span className="text-2xl">🎯</span>
          </div>
          <p className="text-base font-semibold text-foreground">
            {leads.length === 0 ? "No leads yet" : "No matching leads"}
          </p>
          <p className="text-sm text-muted-foreground max-w-sm">
            {leads.length === 0
              ? "Create your first lead or import a spreadsheet to get started."
              : "Try adjusting search or filters."}
          </p>
          {leads.length === 0 && (
            <button
              type="button"
              onClick={openCreate}
              className="mt-3 mm-btn mm-btn-primary min-h-11 px-6 focus-ring"
            >
              Create Lead
            </button>
          )}
        </div>
      ) : (
        <div className="bg-card border border-border rounded-2xl overflow-hidden w-full min-w-0 shrink-0 self-start">
          {/* Mobile cards */}
          <div className="md:hidden divide-y divide-border">
            {pageLeads.map((lead) => (
              <div key={lead.id} className="p-4 space-y-2">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(lead.id)}
                    onChange={() => toggleSelect(lead.id)}
                    className="mt-1 h-4 w-4 rounded border-border bg-background"
                    aria-label={`Select ${lead.name}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-foreground truncate">{lead.name}</div>
                    <div className="text-sm text-muted-foreground">{lead.phone || "—"}</div>
                    <div
                      className="text-xs text-muted-foreground truncate max-w-full"
                      title={lead.company || undefined}
                    >
                      {lead.company || "—"}
                    </div>
                    <div className="flex flex-wrap gap-2 mt-2 text-xs">
                      {lead.district && (
                        <span className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-muted-foreground">
                          {lead.district}
                        </span>
                      )}
                      <span className="px-2 py-0.5 rounded-full bg-white/10 border border-white/10 text-white/80">
                        {lead.status}
                      </span>
                      {lead.aiScore != null ? (
                        <ScoreBadge score={lead.aiScore} />
                      ) : (
                        <span className="text-muted-foreground">No score</span>
                      )}
                    </div>
                    <AiLeadRecommendationBadge
                      rec={aiRecMap[lead.id]}
                      token={token}
                      onDone={() => loadLeads()}
                    />
                    <div className="flex flex-wrap gap-2 mt-3">
                      <button
                        onClick={() => openEdit(lead)}
                        className="px-2.5 py-1 text-xs bg-white/10 rounded-lg border border-white/10"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setMediaSendLead(lead)}
                        className="px-2.5 py-1 text-xs bg-emerald-600/20 text-emerald-300 rounded-lg border border-emerald-500/40"
                      >
                        Send Media
                      </button>
                      <button
                        onClick={() => scoreLead(lead)}
                        disabled={isSubmitting || bulkBusy}
                        className="px-2.5 py-1 text-xs bg-emerald-500/10 text-emerald-400 rounded-lg border border-emerald-500/30"
                      >
                        Score
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop table — sticky header, hover rows, premium shell */}
          <div className="hidden md:block mm-table-wrap max-w-full overflow-y-visible">
            <table className="mm-table min-w-[900px]">
              <thead>
                <tr>
                  <th className="w-10">
                    <input
                      type="checkbox"
                      checked={allPageSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = somePageSelected && !allPageSelected;
                      }}
                      onChange={toggleSelectAllPage}
                      className="h-4 w-4 rounded border-border bg-background"
                      aria-label="Select all on page"
                    />
                  </th>
                  {tableFields.slice(0, 6).map((f) => (
                    <th key={f.key} className="max-w-[180px]">
                      {f.label}
                    </th>
                  ))}
                  <th>Assigned</th>
                  <th>AI Score</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pageLeads.map((lead) => (
                  <tr
                    key={lead.id}
                    data-selected={selectedIds.has(lead.id) ? "true" : undefined}
                  >
                    <td className="p-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(lead.id)}
                        onChange={() => toggleSelect(lead.id)}
                        className="h-4 w-4 rounded border-border bg-background"
                        aria-label={`Select ${lead.name}`}
                      />
                    </td>
                    {tableFields.slice(0, 6).map((f) => {
                      const raw = getContactFieldValue(lead as Record<string, unknown>, f);
                      const isMoney =
                        f.type === "currency" ||
                        f.coreMap === "value" ||
                        /amount|budget|price|fee|revenue|value/i.test(f.key);
                      const moneyN = isMoney
                        ? parseAmount(raw as string | number | null | undefined)
                        : null;
                      const display =
                        raw == null || raw === ""
                          ? "—"
                          : isMoney
                            ? moneyN != null
                              ? formatCurrency(moneyN)
                              : "—"
                            : String(raw);
                      const isStatus = f.coreMap === "status" || f.key === "status";
                      const isName = f.coreMap === "name" || f.key === "name";
                      return (
                        <td key={f.key} className="p-3 max-w-[180px]">
                          {isStatus ? (
                            <span className="inline-block px-2.5 py-0.5 text-xs rounded-full bg-white/10 text-white/80 border border-white/10 capitalize">
                              {display}
                            </span>
                          ) : isName ? (
                            <div>
                              <div className="font-medium text-foreground truncate" title={display}>
                                {display}
                              </div>
                              {lead.email ? (
                                <div className="text-xs text-muted-foreground truncate" title={String(lead.email)}>
                                  {String(lead.email)}
                                </div>
                              ) : null}
                              {aiRecMap[lead.id] ? (
                                <div className="mt-1.5 max-w-xs">
                                  <AiLeadRecommendationBadge
                                    rec={aiRecMap[lead.id]}
                                    token={token}
                                    onDone={() => loadLeads()}
                                  />
                                </div>
                              ) : null}
                            </div>
                          ) : (
                            <div
                              className={`text-muted-foreground truncate ${isMoney ? "tabular-nums text-emerald-400/90" : ""}`}
                              title={display !== "—" ? display : undefined}
                            >
                              {display}
                            </div>
                          )}
                        </td>
                      );
                    })}
                    <td className="p-3">
                      <span
                        className={`text-xs ${lead.assignedTo ? "text-muted-foreground" : "text-muted-foreground"}`}
                        title={lead.assignedTo || undefined}
                      >
                        {assigneeLabel(lead.assignedTo)}
                      </span>
                    </td>
                    <td className="p-3">
                      {lead.aiScore != null ? (
                        <button
                          type="button"
                          onClick={() => scoreLead(lead)}
                          disabled={isSubmitting || bulkBusy}
                          className="hover:opacity-80 transition-opacity"
                          title="Re-score"
                        >
                          <ScoreBadge score={lead.aiScore} />
                        </button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="p-3 text-right whitespace-nowrap space-x-1.5">
                      <button
                        type="button"
                        onClick={() => scoreLead(lead)}
                        disabled={isSubmitting || bulkBusy}
                        className="px-2.5 py-1 text-xs bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 rounded-lg border border-emerald-500/30 disabled:opacity-50"
                      >
                        Score
                      </button>
                      <button
                        type="button"
                        onClick={() => setMediaSendLead(lead)}
                        className="px-2.5 py-1 text-xs bg-emerald-600/15 hover:bg-emerald-600/25 text-emerald-300 rounded-lg border border-emerald-500/40"
                      >
                        Media
                      </button>
                      <button
                        type="button"
                        onClick={() => openEmailCompose([lead])}
                        disabled={bulkBusy || !lead.email}
                        title={lead.email ? `Email ${lead.email}` : "No email on this lead"}
                        className="px-2.5 py-1 text-xs bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 rounded-lg border border-sky-500/30 disabled:opacity-50"
                      >
                        Email
                      </button>
                      <button
                        type="button"
                        onClick={() => openEdit(lead)}
                        className="px-2.5 py-1 text-xs bg-white/10 hover:bg-white/20 rounded-lg border border-white/10"
                      >
                        Edit
                      </button>
                      {(role === "manager" || role === "admin") && (
                        <button
                          type="button"
                          onClick={() => handleDelete(lead.id, lead.name)}
                          className="px-2.5 py-1 text-xs text-red-400 hover:bg-red-950/50 rounded-lg border border-red-900/50"
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-border text-sm text-muted-foreground">
            <div>
              Showing{" "}
              <span className="text-foreground tabular-nums">
                {totalFiltered === 0 ? 0 : pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, totalFiltered)}
              </span>{" "}
              of{" "}
              <span className="text-foreground tabular-nums">{totalFiltered.toLocaleString()}</span>
              {serverTotal !== totalFiltered && (
                <span className="text-muted-foreground">
                  {" "}
                  · {serverTotal.toLocaleString()} total in CRM
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={safePage <= 1 || isLoading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-3 py-1.5 rounded-lg bg-white/5 border border-border hover:bg-white/10 disabled:opacity-40"
              >
                Previous
              </button>
              <span className="tabular-nums text-muted-foreground px-2">
                {safePage} / {totalPages}
              </span>
              <button
                type="button"
                disabled={safePage >= totalPages || isLoading}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="px-3 py-1.5 rounded-lg bg-white/5 border border-border hover:bg-white/10 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create/Edit Modal — DynamicForm from BusinessConfig fields */}
      {showModal && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
            <h2 className="text-xl font-semibold p-6 flex-shrink-0 border-b border-border">
              {editingLead ? "Edit Lead" : "New Lead"}
              {templateSlug ? (
                <span className="block text-xs font-normal text-muted-foreground mt-1">
                  Fields from template: {templateSlug}
                </span>
              ) : null}
            </h2>
            <div className="flex-1 overflow-y-auto px-6 pt-4 pb-6">
              <DynamicForm
                formId="lead-form"
                fields={fieldDefs}
                values={formValues}
                onChange={handleFormChange}
                onSubmit={handleSubmit}
                statusOptions={statusOptions.map((s) => ({ key: s.key, label: s.label }))}
                disabled={isSubmitting}
              />
              <div className="mt-4 p-3 bg-background border border-border rounded-xl">
                <label className="block text-xs text-muted-foreground mb-1.5 tracking-wide">
                  Assign To
                </label>
                <input
                  type="search"
                  value={teamSearch}
                  onChange={(e) => setTeamSearch(e.target.value)}
                  placeholder="Search team members…"
                  className="w-full mb-2 bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground"
                  disabled={isSubmitting}
                />
                <select
                  value={formAssigneeId}
                  onChange={(e) => setFormAssigneeId(e.target.value)}
                  className="w-full bg-card border border-border rounded-lg px-3 py-2.5 text-sm text-foreground min-h-11"
                  disabled={isSubmitting}
                >
                  <option value="">Unassigned</option>
                  {filteredTeam.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name?.trim() || m.email} ({m.email})
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-muted-foreground mt-1.5">
                  Stores user id · shown as name. Sales executives only see leads assigned to them
                  (or created by them).
                </p>
              </div>
              {editingLead && (
                <div className="mt-5 space-y-3">
                  <div className="p-3 bg-background border border-border rounded-xl">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs text-muted-foreground mb-1 tracking-widest">AI LEAD SCORE</div>
                        {(() => {
                          const live = leads.find((l) => l.id === editingLead.id);
                          const currentScore = (live?.aiScore ?? editingLead.aiScore) as
                            | number
                            | null
                            | undefined;
                          return currentScore != null ? (
                            <ScoreBadge score={currentScore} />
                          ) : (
                            <span className="text-xs text-muted-foreground">Not scored yet</span>
                          );
                        })()}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const live = leads.find((l) => l.id === editingLead.id) || editingLead;
                          scoreLead(live);
                        }}
                        disabled={isSubmitting}
                        className="px-3 py-1 text-xs bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 rounded-lg border border-emerald-500/30 disabled:opacity-50"
                      >
                        {isSubmitting ? "Scoring..." : "Score / Refresh"}
                      </button>
                    </div>
                  </div>
                  {aiRecMap[editingLead.id] ? (
                    <div className="p-3 bg-violet-500/5 border border-violet-500/30 rounded-xl">
                      <div className="text-xs text-violet-300/90 tracking-widest mb-2">
                        AI RECOMMENDATION
                      </div>
                      <AiLeadRecommendationBadge
                        rec={aiRecMap[editingLead.id]}
                        token={token}
                        onDone={() => loadLeads()}
                      />
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground px-1">
                      No active AI follow-up for this lead. Engine updates when CRM data changes.
                    </p>
                  )}
                </div>
              )}
            </div>
            <div className="p-6 flex-shrink-0 border-t border-border">
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 px-5 py-2.5 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl text-sm font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  form="lead-form"
                  disabled={isSubmitting}
                  className="flex-1 px-5 py-2.5 bg-primary text-primary-foreground rounded-xl font-medium hover:bg-primary-hover disabled:opacity-50"
                >
                  {isSubmitting ? "Saving..." : editingLead ? "Update Lead" : "Create Lead"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Assign User modal — selected | first N filtered | all filtered (≤50k) */}
      {assignModalOpen && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-end sm:items-center justify-center sm:p-4">
          <div className="bg-card border border-border rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[92dvh] overflow-y-auto p-5 sm:p-6">
            <h3 className="text-lg font-semibold mb-1">Assign User</h3>
            <p className="text-xs text-muted-foreground mb-4">
              Assign leads to an active workspace member. Filtered scopes use current search/status
              (all pages, up to 50,000). Processed in batches of 1,000.
            </p>

            <div className="space-y-2 mb-4">
              <label
                className={`flex items-start gap-3 rounded-xl border p-3 cursor-pointer transition-colors ${
                  assignScope === "ids"
                    ? "border-primary/50 bg-primary/10"
                    : "border-border hover:bg-muted/40"
                } ${selectedIds.size === 0 ? "opacity-60" : ""}`}
              >
                <input
                  type="radio"
                  name="bulk-assign-scope"
                  className="mt-1"
                  checked={assignScope === "ids"}
                  disabled={selectedIds.size === 0}
                  onChange={() => setAssignScope("ids")}
                />
                <span>
                  <span className="block text-sm font-medium text-foreground">
                    Assign selected ({selectedIds.size.toLocaleString()})
                  </span>
                  <span className="block text-xs text-muted-foreground mt-0.5">
                    Only the leads currently checked.
                  </span>
                </span>
              </label>

              <label
                className={`flex items-start gap-3 rounded-xl border p-3 cursor-pointer transition-colors ${
                  assignScope === "first_n"
                    ? "border-primary/50 bg-primary/10"
                    : "border-border hover:bg-muted/40"
                }`}
              >
                <input
                  type="radio"
                  name="bulk-assign-scope"
                  className="mt-1"
                  checked={assignScope === "first_n"}
                  onChange={() => setAssignScope("first_n")}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-foreground">
                    Assign first N filtered leads
                  </span>
                  <span className="block text-xs text-muted-foreground mt-0.5 mb-2">
                    First N matching current filters ({serverTotal.toLocaleString()} total).
                  </span>
                  {assignScope === "first_n" && (
                    <div className="space-y-2" onClick={(e) => e.preventDefault()}>
                      <div className="flex flex-wrap gap-1.5">
                        {(
                          [
                            ["100", "100"],
                            ["250", "250"],
                            ["500", "500"],
                            ["1000", "1,000"],
                            ["5000", "5,000"],
                            ["custom", "Custom"],
                          ] as const
                        ).map(([val, label]) => (
                          <button
                            key={val}
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setAssignFirstPreset(val);
                            }}
                            className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${
                              assignFirstPreset === val
                                ? "bg-primary text-primary-foreground border-primary"
                                : "bg-white/5 border-border hover:bg-white/10"
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      {assignFirstPreset === "custom" && (
                        <div>
                          <input
                            type="number"
                            min={1}
                            max={BULK_ASSIGN_MAX}
                            value={assignCustomCount}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => setAssignCustomCount(e.target.value)}
                            placeholder="Enter count (1–50,000)"
                            className={`${inputClass} tabular-nums`}
                          />
                          {assignCustomValidation ? (
                            <p className="text-xs text-red-400 mt-1">{assignCustomValidation}</p>
                          ) : assignCustomCount.trim() ? (
                            <p className="text-xs text-emerald-400/90 mt-1">
                              Assign first{" "}
                              {Math.min(
                                Number.parseInt(assignCustomCount, 10) || 0,
                                serverTotal,
                                BULK_ASSIGN_MAX
                              ).toLocaleString()}{" "}
                              matching leads.
                            </p>
                          ) : null}
                        </div>
                      )}
                      {assignFirstPreset !== "custom" && (
                        <p className="text-xs text-sky-300/90">
                          Assign first{" "}
                          {Math.min(
                            Number.parseInt(assignFirstPreset, 10),
                            serverTotal || Number.parseInt(assignFirstPreset, 10)
                          ).toLocaleString()}{" "}
                          matching leads.
                        </p>
                      )}
                    </div>
                  )}
                </span>
              </label>

              <label
                className={`flex items-start gap-3 rounded-xl border p-3 cursor-pointer transition-colors ${
                  assignScope === "all_filtered"
                    ? "border-primary/50 bg-primary/10"
                    : "border-border hover:bg-muted/40"
                }`}
              >
                <input
                  type="radio"
                  name="bulk-assign-scope"
                  className="mt-1"
                  checked={assignScope === "all_filtered"}
                  onChange={() => setAssignScope("all_filtered")}
                />
                <span>
                  <span className="block text-sm font-medium text-foreground">
                    Assign all filtered results ({serverTotal.toLocaleString()})
                  </span>
                  <span className="block text-xs text-muted-foreground mt-0.5">
                    Every lead matching current search/status — all pages (up to 50,000).
                    {search || statusFilter ? (
                      <span className="block mt-1 text-amber-200/90">
                        Filters: {statusFilter ? `status=${statusFilter}` : ""}
                        {statusFilter && search ? " · " : ""}
                        {search ? `search="${search}"` : ""}
                      </span>
                    ) : (
                      <span className="block mt-1 text-amber-200/90">
                        No filters — this assigns ALL leads in CRM.
                      </span>
                    )}
                  </span>
                </span>
              </label>
            </div>

            <label className="block text-xs text-muted-foreground mb-1">Assign to</label>
            <input
              type="search"
              value={teamSearch}
              onChange={(e) => setTeamSearch(e.target.value)}
              placeholder="Search name, email, phone, employee ID, username…"
              className={`${inputClass} mb-2`}
            />
            <select
              value={assignValue}
              onChange={(e) => setAssignValue(e.target.value)}
              className={`${inputClass} mb-2 min-h-11`}
            >
              <option value="">Select team member…</option>
              <option value={ALL_MEMBERS_VALUE}>
                All Members ({teamMembers.length}) — equal distribution
              </option>
              {filteredTeam.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name?.trim() || m.email}
                  {m.email ? ` · ${m.email}` : ""}
                  {m.phone ? ` · ${m.phone}` : ""}
                  {m.employeeCode ? ` · ID:${m.employeeCode}` : ""}
                  {m.username ? ` · @${m.username}` : ""}
                </option>
              ))}
            </select>
            {assignValue === ALL_MEMBERS_VALUE && (
              <p className="text-xs text-sky-300/90 mb-3">
                Leads will be split equally among {teamMembers.length} active members (difference at most 1).
              </p>
            )}
            {teamSearch.trim() && filteredTeam.length === 0 && assignValue !== ALL_MEMBERS_VALUE && (
              <p className="text-xs text-amber-300/90 mb-2">No members match “{teamSearch.trim()}”.</p>
            )}
            <label className="block text-xs text-muted-foreground mb-1">Notes (optional)</label>
            <input
              value={assignNotes}
              onChange={(e) => setAssignNotes(e.target.value)}
              placeholder="e.g. Q3 campaign distribution"
              className={`${inputClass} mb-4`}
            />

            {bulkProgress && (
              <div className="flex items-center gap-2 text-xs text-sky-300 mb-3">
                <span className="inline-block w-3.5 h-3.5 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
                {bulkProgress}
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setAssignModalOpen(false);
                  setAssignValue("");
                  setTeamSearch("");
                  setAssignCustomCount("");
                  setAssignNotes("");
                }}
                className="flex-1 min-h-11 px-4 py-2.5 bg-white/10 rounded-xl text-sm border border-white/10"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={
                  bulkBusy ||
                  !assignValue.trim() ||
                  (assignScope === "ids" && selectedIds.size === 0) ||
                  (assignScope === "all_filtered" && serverTotal === 0) ||
                  (assignScope === "first_n" &&
                    (serverTotal === 0 ||
                      (assignFirstPreset === "custom" && !!assignCustomValidation) ||
                      (assignFirstPreset === "custom" && !assignCustomCount.trim()) ||
                      !resolvedAssignLimit ||
                      resolvedAssignLimit < 1))
                }
                onClick={() => void requestAssignPreview()}
                className="flex-1 min-h-11 px-4 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-medium disabled:opacity-50"
              >
                {bulkBusy ? "Preparing…" : "Review & assign"}
              </button>
            </div>
          </div>
        </div>
      )}

      {token && mediaSendLead && (
        <SendMediaModal
          open={!!mediaSendLead}
          onClose={() => setMediaSendLead(null)}
          token={token}
          contactId={mediaSendLead.id}
          contactName={mediaSendLead.name}
          contactPhone={mediaSendLead.phone || mediaSendLead.whatsapp}
        />
      )}

      {/* Assignment confirmation with equal-distribution summary */}
      {assignConfirmOpen && assignPreview && (
        <div className="fixed inset-0 bg-black/75 z-[60] flex items-end sm:items-center justify-center sm:p-4">
          <div className="bg-card border border-border rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 sm:p-6 shadow-2xl">
            <h3 className="text-lg font-semibold text-foreground">Confirm assignment</h3>
            <p className="text-sm text-muted-foreground mt-1 mb-4">
              You are about to assign{" "}
              <span className="text-foreground font-semibold tabular-nums">
                {assignPreview.total.toLocaleString()}
              </span>{" "}
              lead{assignPreview.total === 1 ? "" : "s"}
              {assignPreview.mode === "all_members" ? " with equal distribution." : "."}
            </p>
            <div className="rounded-xl border border-border bg-muted/30 max-h-56 overflow-y-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b border-border">
                    <th className="px-3 py-2 font-medium">Member</th>
                    <th className="px-3 py-2 font-medium text-right">Leads</th>
                  </tr>
                </thead>
                <tbody>
                  {assignPreview.distribution.map((d) => (
                    <tr key={d.userId} className="border-b border-border/60 last:border-0">
                      <td className="px-3 py-2">
                        <div className="font-medium text-foreground">{d.name?.trim() || d.email}</div>
                        <div className="text-[11px] text-muted-foreground">{d.email}</div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold">
                        {d.count.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground mt-3">Continue?</p>
            <div className="flex gap-3 mt-4">
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => {
                  setAssignConfirmOpen(false);
                  setAssignPreview(null);
                }}
                className="flex-1 min-h-11 px-4 py-2.5 bg-white/10 rounded-xl text-sm border border-white/10"
              >
                Back
              </button>
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => void runBulkAssign()}
                className="flex-1 min-h-11 px-4 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-semibold disabled:opacity-50"
              >
                {bulkBusy ? "Assigning…" : "Continue"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Edit modal */}
      {bulkEditOpen && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-end sm:items-center justify-center sm:p-4">
          <div className="bg-card border border-border rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[92dvh] overflow-y-auto p-5 sm:p-6">
            <h3 className="text-lg font-semibold text-foreground">Bulk Edit</h3>
            <p className="text-sm text-sky-300/90 mt-1 font-medium">
              Preview: {selectedIds.size} lead{selectedIds.size === 1 ? "" : "s"} will be updated
            </p>
            <p className="text-xs text-muted-foreground mt-1 mb-4">
              Leave a field empty to keep existing values. Changes are audited.
            </p>
            <div className="space-y-3 adaptive-form">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Status</label>
                <select
                  value={bulkEditForm.status}
                  onChange={(e) => setBulkEditForm({ ...bulkEditForm, status: e.target.value })}
                  className={inputClass}
                >
                  <option value="">— no change —</option>
                  {statusOptions.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Assigned User</label>
                <select
                  value={bulkEditForm.assignedTo}
                  onChange={(e) => setBulkEditForm({ ...bulkEditForm, assignedTo: e.target.value })}
                  className={inputClass}
                >
                  <option value="">— no change —</option>
                  <option value="__unassign__">Unassigned</option>
                  {teamMembers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name?.trim() || m.email}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Lead Source</label>
                <input
                  value={bulkEditForm.source}
                  onChange={(e) => setBulkEditForm({ ...bulkEditForm, source: e.target.value })}
                  placeholder="e.g. website, referral"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Priority</label>
                <select
                  value={bulkEditForm.priority}
                  onChange={(e) => setBulkEditForm({ ...bulkEditForm, priority: e.target.value })}
                  className={inputClass}
                >
                  <option value="">— no change —</option>
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                  <option value="urgent">urgent</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Tags (comma-separated)</label>
                <input
                  value={bulkEditForm.tags}
                  onChange={(e) => setBulkEditForm({ ...bulkEditForm, tags: e.target.value })}
                  placeholder="hot, demo, q1"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Company</label>
                <input
                  value={bulkEditForm.company}
                  onChange={(e) => setBulkEditForm({ ...bulkEditForm, company: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Custom field key</label>
                  <input
                    value={bulkEditForm.customKey}
                    onChange={(e) => setBulkEditForm({ ...bulkEditForm, customKey: e.target.value })}
                    placeholder="district"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Custom field value</label>
                  <input
                    value={bulkEditForm.customValue}
                    onChange={(e) => setBulkEditForm({ ...bulkEditForm, customValue: e.target.value })}
                    className={inputClass}
                  />
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                type="button"
                onClick={() => setBulkEditOpen(false)}
                className="flex-1 min-h-11 px-4 py-2.5 bg-white/10 rounded-xl text-sm border border-white/10"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={bulkBusy}
                onClick={runBulkEdit}
                className="flex-1 min-h-11 px-4 py-2.5 bg-sky-600 hover:bg-sky-500 text-white rounded-xl text-sm font-semibold disabled:opacity-50"
              >
                {bulkBusy ? "Saving…" : `Update ${selectedIds.size} lead(s)`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Delete confirmation — current selection OR all filtered results */}
      {bulkDeleteOpen && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-end sm:items-center justify-center sm:p-4">
          <div className="bg-card border border-red-900/40 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-500/15 text-red-400 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-lg font-semibold text-foreground">Delete leads?</h3>
                <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                  Choose what to delete. Soft-delete moves leads to Trash (audit logged).
                </p>
                <div className="mt-4 space-y-2">
                  <label
                    className={`flex items-start gap-3 rounded-xl border p-3 cursor-pointer transition-colors ${
                      bulkDeleteScope === "selected"
                        ? "border-red-500/50 bg-red-500/10"
                        : "border-border hover:bg-muted/40"
                    }`}
                  >
                    <input
                      type="radio"
                      name="bulk-delete-scope"
                      className="mt-1"
                      checked={bulkDeleteScope === "selected"}
                      onChange={() => setBulkDeleteScope("selected")}
                    />
                    <span>
                      <span className="block text-sm font-medium text-foreground">
                        Delete selected ({selectedIds.size.toLocaleString()})
                      </span>
                      <span className="block text-xs text-muted-foreground mt-0.5">
                        Only the leads currently checked (this page or multi-page selection).
                      </span>
                    </span>
                  </label>
                  <label
                    className={`flex items-start gap-3 rounded-xl border p-3 cursor-pointer transition-colors ${
                      bulkDeleteScope === "all_filtered"
                        ? "border-red-500/50 bg-red-500/10"
                        : "border-border hover:bg-muted/40"
                    }`}
                  >
                    <input
                      type="radio"
                      name="bulk-delete-scope"
                      className="mt-1"
                      checked={bulkDeleteScope === "all_filtered"}
                      onChange={() => setBulkDeleteScope("all_filtered")}
                    />
                    <span>
                      <span className="block text-sm font-medium text-foreground">
                        Delete all filtered results ({serverTotal.toLocaleString()})
                      </span>
                      <span className="block text-xs text-muted-foreground mt-0.5">
                        Every lead matching current search/status — all pages (up to 50,000).
                        {search || statusFilter ? (
                          <span className="block mt-1 text-amber-200/90">
                            Filters: {statusFilter ? `status=${statusFilter}` : ""}
                            {statusFilter && search ? " · " : ""}
                            {search ? `search="${search}"` : ""}
                          </span>
                        ) : (
                          <span className="block mt-1 text-amber-200/90">
                            No filters — this deletes ALL leads in CRM.
                          </span>
                        )}
                      </span>
                    </span>
                  </label>
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                type="button"
                onClick={() => setBulkDeleteOpen(false)}
                className="flex-1 min-h-11 px-4 py-2.5 bg-white/10 rounded-xl text-sm border border-white/10"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={
                  bulkBusy ||
                  (bulkDeleteScope === "selected" && selectedIds.size === 0) ||
                  (bulkDeleteScope === "all_filtered" && serverTotal === 0)
                }
                onClick={() => void runBulkDelete()}
                className="flex-1 min-h-11 px-4 py-2.5 bg-red-600 hover:bg-red-500 text-white rounded-xl text-sm font-semibold disabled:opacity-50"
              >
                {bulkBusy
                  ? "Deleting…"
                  : bulkDeleteScope === "all_filtered"
                    ? `Trash ${serverTotal.toLocaleString()} filtered`
                    : `Trash ${selectedIds.size.toLocaleString()} selected`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Compose email modal */}
      {emailModalOpen && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-end sm:items-center justify-center sm:p-4">
          <div className="bg-card border border-border rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg p-5 sm:p-6 shadow-2xl">
            <h3 className="text-lg font-semibold text-foreground">Compose email</h3>
            <p className="text-xs text-muted-foreground mt-1 mb-4">
              Sent via platform email (SMTP).{" "}
              {emailContactIds.length > 1
                ? `${emailContactIds.length} recipients will each get a personal copy.`
                : "Recipient is prefilled from the lead."}
            </p>
            <label className="block text-sm text-muted-foreground mb-1.5">To</label>
            <input
              type="text"
              value={emailTo}
              onChange={(e) => setEmailTo(e.target.value)}
              disabled={emailContactIds.length > 1}
              className={`${inputClass} mb-3 ${emailContactIds.length > 1 ? "opacity-80" : ""}`}
              placeholder="recipient@example.com"
              autoComplete="email"
            />
            <label className="block text-sm text-muted-foreground mb-1.5">Subject</label>
            <input
              type="text"
              value={emailSubject}
              onChange={(e) => setEmailSubject(e.target.value)}
              className={`${inputClass} mb-3`}
              placeholder="Subject"
              maxLength={200}
            />
            <label className="block text-sm text-muted-foreground mb-1.5">Message</label>
            <textarea
              value={emailBody}
              onChange={(e) => setEmailBody(e.target.value)}
              className={`${inputClass} min-h-[160px] mb-4 resize-y`}
              placeholder="Write your message…"
              rows={8}
            />
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setEmailModalOpen(false)}
                disabled={emailSending}
                className="flex-1 min-h-11 px-4 py-2.5 bg-white/10 rounded-xl text-sm border border-white/10"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={emailSending}
                onClick={() => void sendComposedEmail()}
                className="flex-1 min-h-11 px-4 py-2.5 bg-sky-600 hover:bg-sky-500 text-white rounded-xl text-sm font-semibold disabled:opacity-50"
              >
                {emailSending ? "Sending…" : "Send email"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Follow-up modal */}
      {followUpModalOpen && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-2xl w-full max-w-md p-6">
            <h3 className="text-lg font-semibold mb-1">Create Follow-up</h3>
            <p className="text-xs text-muted-foreground mb-4">
              Create a task for each of the {selectedIds.size} selected lead(s).
            </p>
            <label className="block text-sm text-muted-foreground mb-1.5">Task title prefix</label>
            <input
              type="text"
              value={followUpTitle}
              onChange={(e) => setFollowUpTitle(e.target.value)}
              className={`${inputClass} mb-3`}
            />
            <label className="block text-sm text-muted-foreground mb-1.5">Due in (days)</label>
            <input
              type="number"
              min="0"
              value={followUpDays}
              onChange={(e) => setFollowUpDays(e.target.value)}
              className={`${inputClass} mb-4`}
            />
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setFollowUpModalOpen(false)}
                className="flex-1 px-4 py-2.5 bg-white/10 rounded-xl text-sm border border-white/10"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={bulkBusy}
                onClick={runBulkFollowUp}
                className="flex-1 px-4 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-medium disabled:opacity-50"
              >
                {bulkBusy ? "Creating…" : "Create tasks"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Score Result Modal */}
      {scoreResult && (
        <div className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold">AI Lead Score</h3>
                <p className="text-xs text-muted-foreground">{scoreResult.leadName}</p>
              </div>
              <button
                onClick={() => setScoreResult(null)}
                className="text-muted-foreground hover:text-foreground text-xl leading-none"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="text-center py-2">
              <div className="text-7xl font-bold tabular-nums text-foreground mb-3">{scoreResult.score}</div>
              <ScoreBadge score={scoreResult.score} />
              <div className="mt-5 p-4 bg-background border border-border rounded-xl text-left">
                <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Reason</div>
                <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                  {scoreResult.explanation}
                </p>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(scoreResult.explanation);
                  toast.success("Reason copied to clipboard");
                }}
                className="flex-1 px-5 py-2.5 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl text-sm font-medium"
              >
                Copy Reason
              </button>
              <button
                type="button"
                onClick={() => setScoreResult(null)}
                className="flex-1 px-5 py-2.5 bg-primary text-primary-foreground rounded-xl font-medium hover:bg-primary-hover"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
