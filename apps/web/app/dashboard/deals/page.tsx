"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { parseAmount } from "@/lib/currency";
import { useBusinessCurrency } from "@/lib/use-business-currency";
import { CurrencyAmountInput } from "@/components/ui/CurrencyAmountInput";
import { ExportFiltersBar } from "@/components/ui/ExportFiltersBar";
import { toIsoDateTime, toDateInputValue } from "@/lib/date-input";
import { useDataVersion } from "@/lib/data-events";
import { PageLoading } from "@/components/ui/PageLoading";
import { friendlyError, SuccessMsg } from "@/lib/user-messages";
import { NotesPanel } from "@/components/crm/NotesPanel";
import {
  CustomFieldsFormSection,
  customFieldsFromRecord,
} from "@/components/custom-fields/CustomFieldsFormSection";
import {
  normalizePipelineStatus,
  pipelineStatusLabel,
  UNIFIED_PIPELINE_STATUSES,
  UNIFIED_STATUS_KEYS,
} from "@/lib/pipeline-statuses";

interface Deal {
  id: string;
  title: string;
  value?: number;
  stage: string;
  expectedClose?: string;
  probability?: number;
  notes?: string;
  contactId?: string;
  contact?: { id: string; name: string; type: string; status?: string };
  leadStatus?: string | null;
  leadStatusLabel?: string | null;
  customFields?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

/** Unified 15-status Kanban (same vocabulary as Leads) */
const STAGES = UNIFIED_STATUS_KEYS as readonly string[];
type StageKey = string;

const STAGE_LABELS: Record<string, string> = Object.fromEntries(
  UNIFIED_PIPELINE_STATUSES.map((s) => [s.key, s.label])
);

/** Map any API/legacy Deal.stage onto exactly one Kanban column key. */
function normalizeDealStage(raw: string | null | undefined): StageKey {
  return normalizePipelineStatus(raw);
}

function stageLabel(stage: string): string {
  const k = normalizeDealStage(stage);
  return STAGE_LABELS[k] || pipelineStatusLabel(k) || stage || "Unknown";
}

/** One card per id — keep the most recently updated row. */
function dedupeDeals(list: Deal[]): Deal[] {
  const map = new Map<string, Deal>();
  for (const d of list) {
    if (!d?.id) continue;
    const prev = map.get(d.id);
    if (!prev) {
      map.set(d.id, d);
      continue;
    }
    const prevT = new Date(prev.updatedAt || 0).getTime();
    const nextT = new Date(d.updatedAt || 0).getTime();
    if (nextT >= prevT) map.set(d.id, d);
  }
  return Array.from(map.values());
}

export default function DealsPage() {
  const { token } = useAuth();
  const { money } = useBusinessCurrency();
  const dataVersion = useDataVersion();
  const searchParams = useSearchParams();
  // Analytics drill-down: ?stage=
  const stageFromUrl = searchParams.get("stage");
  const highlightStage = stageFromUrl ? normalizeDealStage(stageFromUrl) : null;
  const stageColRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [deals, setDeals] = useState<Deal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"kanban" | "list">("kanban");
  const [showModal, setShowModal] = useState(false);
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null);
  const [formData, setFormData] = useState({
    title: "",
    value: "",
    stage: "new",
    expectedClose: "",
    probability: "",
    notes: "",
  });
  const [customFields, setCustomFields] = useState<Record<string, unknown>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [draggedDealId, setDraggedDealId] = useState<string | null>(null);

  useEffect(() => {
    if (!highlightStage || isLoading) return;
    const el = stageColRefs.current[highlightStage];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }
  }, [highlightStage, isLoading, deals.length]);

  const loadDeals = useCallback(async (opts?: { silent?: boolean }) => {
    if (!token) return;
    if (!opts?.silent) setIsLoading(true);
    try {
      // Full board — avoid partial page leaving stale columns
      const apiRes = await api.getCrmDeals("?pageSize=200&sortBy=updatedAt&sortDir=desc", token);
      const data = (apiRes.data || {}) as {
        deals?: Deal[];
        items?: Deal[];
      };
      const list = Array.isArray(data.deals)
        ? data.deals
        : Array.isArray(data.items)
          ? data.items
          : Array.isArray(apiRes.data)
            ? (apiRes.data as Deal[])
            : [];
      if (apiRes.success) {
        const normalized = dedupeDeals(
          list.map((d) => ({
            ...d,
            id: d?.id || "",
            title: d?.title || "Untitled",
            // Exactly one pipeline stage — aliases collapse here
            stage: normalizeDealStage(d?.stage),
            leadStatus: d?.leadStatus ?? d?.contact?.status ?? null,
            leadStatusLabel: d?.leadStatusLabel ?? null,
            customFields: d?.customFields ?? null,
          }))
        );
        setDeals(normalized);
      } else {
        setDeals([]);
        if (!opts?.silent) toast.error(friendlyError(apiRes.error, "Could not load deals. Please try again."));
      }
    } catch {
      setDeals([]);
      if (!opts?.silent) toast.error("Failed to load deals");
    }
    if (!opts?.silent) setIsLoading(false);
  }, [token]);

  // Initial load + live refresh after Lead Won / pipeline sync / other CRM mutations
  useEffect(() => {
    void loadDeals();
  }, [loadDeals, dataVersion]);

  const filteredDeals = useMemo(() => {
    return (deals || []).filter((deal) => {
      if (!search) return true;
      const term = search.toLowerCase();
      const title = (deal?.title || "").toLowerCase();
      const contactName = (deal?.contact?.name || "").toLowerCase();
      const notes = (deal?.notes || "").toLowerCase();
      return title.includes(term) || contactName.includes(term) || notes.includes(term);
    });
  }, [deals, search]);

  /**
   * Kanban: each deal is pushed into exactly one column (normalized stage).
   * Rebuilt every render from DB-backed state — no multi-column membership.
   */
  const dealsByStage = useMemo(() => {
    const buckets: Record<string, Deal[]> = {};
    for (const key of STAGES) buckets[key] = [];
    const seen = new Set<string>();
    for (const deal of filteredDeals) {
      if (!deal?.id || seen.has(deal.id)) continue;
      seen.add(deal.id);
      const stage = normalizeDealStage(deal.stage);
      if (!buckets[stage]) buckets[stage] = [];
      buckets[stage].push({ ...deal, stage });
    }
    return buckets;
  }, [filteredDeals]);

  const handleChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const openCreate = () => {
    setEditingDeal(null);
    setFormData({
      title: "",
      value: "",
      stage: "new",
      expectedClose: "",
      probability: "",
      notes: "",
    });
    setCustomFields({});
    setShowModal(true);
  };

  const openEdit = (deal: Deal) => {
    setEditingDeal(deal);
    setFormData({
      title: deal.title,
      value: deal.value ? String(deal.value) : "",
      stage: normalizeDealStage(deal.stage),
      expectedClose: toDateInputValue(deal.expectedClose),
      probability: deal.probability ? String(deal.probability) : "",
      notes: deal.notes || "",
    });
    setCustomFields(customFieldsFromRecord(deal));
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingDeal(null);
    setCustomFields({});
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;

    if (!formData.title.trim()) {
      toast.error("Title is required");
      return;
    }

    // Value validation (raw numeric string — commas never stored in state)
    if (formData.value.trim()) {
      const v = parseAmount(formData.value);
      if (v == null || v < 0) {
        toast.error("Value must be a non-negative number");
        return;
      }
    }

    // Date validation → ISO for API
    let expectedCloseIso: string | null = null;
    if (formData.expectedClose?.trim()) {
      expectedCloseIso = toIsoDateTime(formData.expectedClose.trim());
      if (!expectedCloseIso) {
        toast.error("Invalid expected close date");
        return;
      }
    }

    // Probability
    if (formData.probability.trim()) {
      const p = parseInt(formData.probability);
      if (isNaN(p) || p < 0 || p > 100) {
        toast.error("Probability must be between 0 and 100");
        return;
      }
    }

    setIsSubmitting(true);

    const payload: Record<string, unknown> = {
      title: formData.title.trim(),
      stage: formData.stage,
      notes: formData.notes.trim() || null,
      customFields,
    };

    if (formData.value) {
      const v = parseAmount(formData.value);
      if (v != null) payload.value = v;
    }
    if (expectedCloseIso) payload.expectedClose = expectedCloseIso;
    if (formData.probability) payload.probability = parseInt(formData.probability);

    let apiRes;
    if (editingDeal) {
      apiRes = await api.updateCrmDeal(editingDeal.id, payload, token);
    } else {
      apiRes = await api.createCrmDeal(payload, token);
    }

    if (apiRes.success) {
      const sync = (
        apiRes.data as {
          pipelineSync?: {
            contactStatusSynced?: boolean;
            contactConvertedToClient?: boolean;
          } | null;
        } | undefined
      )?.pipelineSync;
      let msg = editingDeal ? SuccessMsg.dealUpdated : SuccessMsg.dealCreated;
      if (sync?.contactConvertedToClient) msg += " · Lead → Client";
      else if (sync?.contactStatusSynced) msg += " · Lead synced";
      toast.success(msg);
      closeModal();
      const { emitDataChanged } = await import("@/lib/data-events");
      emitDataChanged({ module: "all", action: editingDeal ? "update" : "create" });
      emitDataChanged({ module: "deal", action: editingDeal ? "update" : "create" });
      emitDataChanged({ module: "contact", action: "update" });
      emitDataChanged({ module: "notification", action: "create" });
      await loadDeals();
    } else {
      toast.error(friendlyError(apiRes.error, "Could not save deal. Please try again."));
    }

    setIsSubmitting(false);
  };

  const handleDelete = async (id: string, title: string) => {
    if (!token) return;
    if (!confirm(`Delete deal "${title}"? This action cannot be undone.`)) return;

    const response = await api.deleteCrmDeal(id, token);
    if (response.success) {
      toast.success(SuccessMsg.dealDeleted);
      await loadDeals();
    } else {
      toast.error(friendlyError(response.error, "Could not delete deal. Please try again."));
    }
  };

  // Drag and drop for Kanban
  const handleDragStart = (e: React.DragEvent, dealId: string) => {
    setDraggedDealId(dealId);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = async (e: React.DragEvent, newStage: string) => {
    e.preventDefault();
    if (!draggedDealId || !token) return;

    const deal = deals.find((d) => d.id === draggedDealId);
    if (!deal || deal.stage === newStage) {
      setDraggedDealId(null);
      return;
    }

    const nextStage = normalizeDealStage(newStage);

    // Optimistic: move only this id to the new column (remove from previous)
    setDeals((prev) =>
      dedupeDeals(
        prev.map((d) =>
          d.id === draggedDealId ? { ...d, stage: nextStage, updatedAt: new Date().toISOString() } : d
        )
      )
    );

    const apiRes = await api.updateCrmDeal(draggedDealId, { stage: nextStage }, token);

    if (!apiRes.success) {
      toast.error("Failed to update stage");
      await loadDeals(); // revert from DB
    } else {
      const sync = (
        apiRes.data as {
          pipelineSync?: {
            contactStatusSynced?: boolean;
            contactConvertedToClient?: boolean;
            messages?: string[];
          } | null;
        } | undefined
      )?.pipelineSync;
      let msg = `Moved to ${stageLabel(nextStage)}`;
      if (sync?.contactConvertedToClient) msg += " · Lead converted to Client";
      else if (sync?.contactStatusSynced) msg += " · Lead status synced";
      toast.success(msg);
      // Authoritative reload so counts match DB (Lead −1, Closed Won +1)
      await loadDeals({ silent: true });
      const { emitDataChanged } = await import("@/lib/data-events");
      emitDataChanged({ module: "all", action: "update" });
      emitDataChanged({ module: "deal", action: "update" });
      emitDataChanged({ module: "contact", action: "update" });
      emitDataChanged({ module: "notification", action: "create" });
    }

    setDraggedDealId(null);
  };

  return (
    <div className="w-full max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-6 overflow-x-hidden pb-24 md:pb-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-4 sm:mb-5">
        <div className="min-w-0">
          <h1 className="mm-page-title">Deals</h1>
          <p className="mm-secondary mt-1">
            Pipeline management with Kanban view.
          </p>
        </div>
        <div className="flex flex-col xs:flex-row gap-2 w-full sm:w-auto">
          <div className="flex rounded-md border border-border overflow-hidden shrink-0">
            <button
              type="button"
              onClick={() => setView("kanban")}
              className={`mm-btn flex-1 sm:flex-none rounded-none h-9 min-h-9 px-3 text-[13px] touch-manipulation ${view === "kanban" ? "bg-muted text-foreground" : "bg-card text-muted-foreground"}`}
            >
              Kanban
            </button>
            <button
              type="button"
              onClick={() => setView("list")}
              className={`mm-btn flex-1 sm:flex-none rounded-none h-9 min-h-9 px-3 text-[13px] touch-manipulation ${view === "list" ? "bg-muted text-foreground" : "bg-card text-muted-foreground"}`}
            >
              List
            </button>
          </div>
          <button
            type="button"
            onClick={openCreate}
            className="mm-btn mm-btn-primary w-full sm:w-auto h-9 min-h-9 px-4 text-[13px] focus-ring touch-manipulation"
          >
            + New Deal
          </button>
        </div>
      </div>

      <ExportFiltersBar module="deals" token={token} search={search} onSearchChange={setSearch} className="mb-3" />
      <div className="mm-filter-bar mb-4">
        <input
          type="search"
          placeholder="Search deals..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mm-input w-full max-w-md"
        />
      </div>

      {isLoading ? (
        <PageLoading variant="kanban" label="Loading deals" />
      ) : view === "kanban" ? (
        <>
          {highlightStage && (
            <div className="mb-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-[13px] text-foreground">
              Filtered from analytics · highlighting{" "}
              <span className="font-semibold">{stageLabel(highlightStage)}</span>
            </div>
          )}
          {/* Mobile: stacked stage sections (no horizontal squeeze) */}
          <div className="md:hidden space-y-3">
            {STAGES.map((stage) => (
              <div
                key={stage}
                ref={(el) => {
                  stageColRefs.current[stage] = el;
                }}
                className={`mm-card p-3 ${
                  highlightStage === stage
                    ? "border-primary ring-1 ring-primary/20"
                    : ""
                }`}
              >
                <div className="flex items-center justify-between mb-2 px-0.5">
                  <div className="mm-section-title text-[13px]">{stageLabel(stage)}</div>
                  <div className="mm-badge">
                    {(dealsByStage[stage] || []).length}
                  </div>
                </div>
                <div className="space-y-2">
                  {(dealsByStage[stage] || []).length > 0 ? (
                    (dealsByStage[stage] || []).map((deal) => (
                      <div
                        key={deal.id || `${stage}-${deal.title}`}
                        className="bg-card border border-border rounded-md p-2.5 space-y-2"
                      >
                        <div className="font-medium text-[13px] text-foreground">{deal.title || "Untitled"}</div>
                        {deal.contact?.name ? (
                          <div className="text-xs text-muted-foreground">{deal.contact.name}</div>
                        ) : null}
                        <div className="flex justify-between items-center gap-2">
                          <div className="text-[13px] text-foreground tabular-nums">
                            {deal.value != null ? money(deal.value) : "—"}
                          </div>
                          <div className="flex gap-1.5 flex-wrap">
                            <Link
                              href={`/dashboard/erp/sales-orders?dealId=${encodeURIComponent(deal.id)}`}
                              className="mm-btn mm-btn-secondary h-9 min-h-9 px-2.5 text-xs touch-manipulation"
                              title="Create Sales Order"
                            >
                              SO
                            </Link>
                            <button
                              type="button"
                              onClick={() => openEdit(deal)}
                              className="mm-btn mm-btn-secondary h-9 min-h-9 px-2.5 text-xs touch-manipulation"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(deal.id, deal.title)}
                              className="mm-btn mm-btn-danger h-9 min-h-9 px-2.5 text-xs touch-manipulation"
                            >
                              Del
                            </button>
                          </div>
                        </div>
                        {/* Stage change on mobile (no drag) */}
                        <select
                          value={normalizeDealStage(deal.stage)}
                          onChange={async (e) => {
                            if (!token || e.target.value === deal.stage) return;
                            const newStage = normalizeDealStage(e.target.value);
                            setDeals((prev) =>
                              dedupeDeals(
                                prev.map((d) =>
                                  d.id === deal.id
                                    ? { ...d, stage: newStage, updatedAt: new Date().toISOString() }
                                    : d
                                )
                              )
                            );
                            const apiRes = await api.updateCrmDeal(deal.id, { stage: newStage }, token);
                            if (!apiRes.success) {
                              toast.error("Failed to update stage");
                              await loadDeals();
                            } else {
                              toast.success(`Moved to ${stageLabel(newStage)}`);
                              await loadDeals({ silent: true });
                            }
                          }}
                          className="mm-input w-full text-xs"
                          aria-label={`Change stage for ${deal.title}`}
                        >
                          {STAGES.map((s) => (
                            <option key={s} value={s}>{STAGE_LABELS[s]}</option>
                          ))}
                        </select>
                      </div>
                    ))
                  ) : (
                    <div className="mm-empty py-6">
                      <p className="mm-secondary">No deals in this stage</p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Tablet/desktop: horizontal scroll for 15-status pipeline */}
          <div className="hidden md:block overflow-x-auto pb-2">
            <div className="flex gap-2.5 min-w-max">
            {STAGES.map((stage) => (
              <div
                key={stage}
                ref={(el) => {
                  stageColRefs.current[`desk-${stage}`] = el;
                  if (typeof window !== "undefined" && window.innerWidth >= 768) {
                    stageColRefs.current[stage] = el;
                  }
                }}
                className={`mm-card p-2.5 min-h-[400px] w-[200px] shrink-0 ${
                  highlightStage === stage
                    ? "border-primary ring-1 ring-primary/20"
                    : ""
                }`}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, stage)}
              >
                <div className="flex items-center justify-between mb-2 px-0.5 gap-1">
                  <div className="mm-section-title text-xs leading-tight">
                    {stageLabel(stage)}
                  </div>
                  <div className="mm-badge shrink-0">
                    {(dealsByStage[stage] || []).length}
                  </div>
                </div>
                <div className="space-y-2">
                  {(dealsByStage[stage] || []).length > 0 ? (
                    (dealsByStage[stage] || []).map((deal) => (
                      <div
                        key={deal.id || `${stage}-${deal.title}`}
                        draggable
                        onDragStart={(e) => handleDragStart(e, deal.id)}
                        className="bg-card border border-border rounded-md p-2.5 cursor-grab active:cursor-grabbing hover:border-border"
                      >
                        <div className="font-medium text-[13px] text-foreground mb-1">{deal.title || "Untitled"}</div>
                        {deal.contact?.name ? (
                          <div className="text-xs text-muted-foreground mb-1.5">{deal.contact.name}</div>
                        ) : null}
                        <div className="flex justify-between items-center text-xs">
                          <div className="text-foreground tabular-nums">
                            {deal.value != null ? money(deal.value) : "-"}
                          </div>
                          <div className="flex gap-1">
                            <Link
                              href={`/dashboard/erp/sales-orders?dealId=${encodeURIComponent(deal.id)}`}
                              className="mm-btn mm-btn-secondary h-7 min-h-7 px-1.5 text-[10px]"
                              title="Create Sales Order"
                              onClick={(e) => e.stopPropagation()}
                            >
                              SO
                            </Link>
                            <button
                              type="button"
                              onClick={() => openEdit(deal)}
                              className="mm-btn mm-btn-secondary h-7 min-h-7 px-1.5 text-[10px]"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(deal.id, deal.title)}
                              className="mm-btn mm-btn-danger h-7 min-h-7 px-1.5 text-[10px]"
                            >
                              Del
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="mm-empty py-8">
                      <p className="mm-secondary">Drop deals here</p>
                    </div>
                  )}
                </div>
              </div>
            ))}
            </div>
          </div>
        </>
      ) : (
        <>
          {/* Mobile list cards */}
          <div className="md:hidden space-y-2.5">
            {filteredDeals.map((deal) => (
              <div
                key={deal.id}
                className="mm-card p-3 space-y-2.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-[13px] text-foreground truncate">{deal.title || "Untitled"}</div>
                    <div className="mm-secondary mt-0.5">{deal.contact?.name || "—"}</div>
                  </div>
                  <span className="mm-badge shrink-0">
                    {stageLabel(deal.stage)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] text-foreground tabular-nums">
                    {deal.value != null ? money(deal.value) : "—"}
                  </span>
                  <div className="flex gap-1.5 flex-wrap">
                    <Link
                      href={`/dashboard/erp/sales-orders?dealId=${encodeURIComponent(deal.id)}`}
                      className="mm-btn mm-btn-secondary h-9 min-h-9 px-2.5 text-xs touch-manipulation"
                    >
                      SO
                    </Link>
                    <button
                      type="button"
                      onClick={() => openEdit(deal)}
                      className="mm-btn mm-btn-secondary h-9 min-h-9 px-2.5 text-xs touch-manipulation"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(deal.id, deal.title)}
                      className="mm-btn mm-btn-danger h-9 min-h-9 px-2.5 text-xs touch-manipulation"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block mm-table-wrap">
            <div className="table-scroll">
              <table className="mm-table min-w-[640px]">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Contact</th>
                    <th>Stage</th>
                    <th>Value</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDeals.map((deal) => (
                    <tr key={deal.id}>
                      <td className="font-medium text-foreground">{deal.title || "Untitled"}</td>
                      <td className="text-muted-foreground">{deal.contact?.name || "-"}</td>
                      <td>
                        <span className="mm-badge">{stageLabel(deal.stage)}</span>
                      </td>
                      <td className="text-foreground tabular-nums">{deal.value != null ? money(deal.value) : "-"}</td>
                      <td className="text-right space-x-1.5">
                        <Link
                          href={`/dashboard/erp/sales-orders?dealId=${encodeURIComponent(deal.id)}`}
                          className="mm-btn mm-btn-secondary h-8 min-h-8 px-2.5 text-xs inline-flex"
                        >
                          SO
                        </Link>
                        <button type="button" onClick={() => openEdit(deal)} className="mm-btn mm-btn-secondary h-8 min-h-8 px-2.5 text-xs">Edit</button>
                        <button type="button" onClick={() => handleDelete(deal.id, deal.title)} className="mm-btn mm-btn-danger h-8 min-h-8 px-2.5 text-xs">Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/50 dark:bg-black/60 z-50 flex items-end sm:items-center justify-center sm:p-4">
          <div className="relative w-full bg-card border border-border shadow-lg rounded-t-xl sm:rounded-lg max-h-[92dvh] sm:max-h-[85vh] flex flex-col overflow-hidden sm:max-w-3xl safe-bottom">
            <div className="shrink-0 px-4 sm:px-5 py-3 border-b border-border">
              <h2 className="mm-section-title text-base">{editingDeal ? "Edit Deal" : "New Deal"}</h2>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 sm:px-5 py-4">
              <form id="deal-form" onSubmit={handleSubmit} className="adaptive-form space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
                  <div className="md:col-span-2">
                    <label className="mm-label">Title *</label>
                    <input
                      value={formData.title}
                      onChange={(e) => handleChange("title", e.target.value)}
                      className="mm-input"
                      required
                    />
                  </div>
                  <div>
                    <label className="mm-label">Value</label>
                    <CurrencyAmountInput
                      value={formData.value}
                      onValueChange={(raw) => handleChange("value", raw)}
                      className="mm-input"
                      placeholder="e.g. 1,00,000"
                    />
                  </div>
                  <div>
                    <label className="mm-label">Stage</label>
                    <select
                      value={formData.stage}
                      onChange={(e) => handleChange("stage", e.target.value)}
                      className="mm-input"
                    >
                      {STAGES.map((s) => (
                        <option key={s} value={s}>{STAGE_LABELS[s]}</option>
                      ))}
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label className="mm-label">Deal summary notes</label>
                    <textarea
                      value={formData.notes}
                      onChange={(e) => handleChange("notes", e.target.value)}
                      className="mm-input h-24"
                      placeholder="Short notes saved on this deal record"
                    />
                  </div>
                </div>
                <CustomFieldsFormSection
                  entity="deal"
                  values={customFields}
                  onChange={setCustomFields}
                  disabled={isSubmitting}
                />
              </form>
              {editingDeal?.id ? (
                <div className="mt-4 pt-4 border-t border-border">
                  <NotesPanel
                    entityType="deal"
                    entityId={editingDeal.id}
                    compact
                    title="Attached notes"
                  />
                </div>
              ) : null}
            </div>
            <div className="shrink-0 border-t border-border px-4 sm:px-5 py-3 safe-bottom bg-background-secondary/60 flex gap-2">
              <button type="button" onClick={closeModal} className="mm-btn mm-btn-secondary flex-1 touch-manipulation">Cancel</button>
              <button type="submit" form="deal-form" disabled={isSubmitting} className={`mm-btn mm-btn-primary flex-1 touch-manipulation ${isSubmitting ? "mm-btn-loading" : ""}`}>
                {isSubmitting ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
