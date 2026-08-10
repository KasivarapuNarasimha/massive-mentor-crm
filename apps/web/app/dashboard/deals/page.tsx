"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { formatCurrency, parseAmount } from "@/lib/currency";
import { CurrencyAmountInput } from "@/components/ui/CurrencyAmountInput";
import { ExportFiltersBar } from "@/components/ui/ExportFiltersBar";
import { toIsoDateTime, toDateInputValue } from "@/lib/date-input";
import { useDataVersion } from "@/lib/data-events";
import { PageLoading } from "@/components/ui/PageLoading";
import { friendlyError, SuccessMsg } from "@/lib/user-messages";

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
  /** Latest Lead status (for My Deals display after Lead → Deal sync) */
  leadStatus?: string | null;
  leadStatusLabel?: string | null;
  customFields?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

function dealLeadStatusLabel(deal: Deal): string | null {
  const fromApi = deal.leadStatusLabel || deal.leadStatus;
  if (fromApi) {
    return String(fromApi)
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
  const cf = deal.customFields || {};
  const lbl = cf.leadStatusLabel || cf.leadStatus || deal.contact?.status;
  if (!lbl) return null;
  return String(lbl)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const STAGES = ["lead", "qualified", "proposal", "negotiation", "closed_won", "closed_lost"] as const;
type StageKey = (typeof STAGES)[number];

const STAGE_LABELS: Record<string, string> = {
  lead: "Lead",
  qualified: "Qualified",
  proposal: "Proposal",
  negotiation: "Negotiation",
  closed_won: "Closed Won",
  closed_lost: "Closed Lost",
};

/** Map any API/legacy alias onto exactly one Kanban column key. */
function normalizeDealStage(raw: string | null | undefined): StageKey {
  const s = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (s === "closed_won" || s === "won" || s === "closedwon") return "closed_won";
  if (s === "closed_lost" || s === "lost" || s === "closedlost") return "closed_lost";
  if (s === "qualified" || s === "qualification") return "qualified";
  if (s === "proposal" || s === "propose" || s === "quoted") return "proposal";
  if (s === "negotiation" || s === "negotiate") return "negotiation";
  if (s === "lead" || s === "new" || s === "contacted") return "lead";
  if ((STAGES as readonly string[]).includes(s)) return s as StageKey;
  return "lead";
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
    stage: "lead",
    expectedClose: "",
    probability: "",
    notes: "",
  });
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
    const buckets: Record<StageKey, Deal[]> = {
      lead: [],
      qualified: [],
      proposal: [],
      negotiation: [],
      closed_won: [],
      closed_lost: [],
    };
    const seen = new Set<string>();
    for (const deal of filteredDeals) {
      if (!deal?.id || seen.has(deal.id)) continue;
      seen.add(deal.id);
      const stage = normalizeDealStage(deal.stage);
      buckets[stage].push({ ...deal, stage });
    }
    return buckets;
  }, [filteredDeals]);

  const stageLabel = (stage: string) => STAGE_LABELS[normalizeDealStage(stage)] || stage || "Unknown";

  const handleChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const openCreate = () => {
    setEditingDeal(null);
    setFormData({
      title: "",
      value: "",
      stage: "lead",
      expectedClose: "",
      probability: "",
      notes: "",
    });
    setShowModal(true);
  };

  const openEdit = (deal: Deal) => {
    setEditingDeal(deal);
    setFormData({
      title: deal.title,
      value: deal.value ? String(deal.value) : "",
      stage: deal.stage,
      expectedClose: toDateInputValue(deal.expectedClose),
      probability: deal.probability ? String(deal.probability) : "",
      notes: deal.notes || "",
    });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingDeal(null);
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
    <div className="w-full max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-8 overflow-x-hidden pb-24 md:pb-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-5 sm:mb-8">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Deals</h1>
          <p className="text-muted-foreground mt-1 sm:mt-2 text-sm sm:text-base">
            Pipeline management with Kanban view.
          </p>
        </div>
        <div className="flex flex-col xs:flex-row gap-2 w-full sm:w-auto">
          <div className="flex rounded-xl border border-border overflow-hidden shrink-0">
            <button
              type="button"
              onClick={() => setView("kanban")}
              className={`flex-1 sm:flex-none min-h-11 px-4 py-2 text-sm touch-manipulation ${view === "kanban" ? "bg-white/10 text-foreground" : "text-muted-foreground"}`}
            >
              Kanban
            </button>
            <button
              type="button"
              onClick={() => setView("list")}
              className={`flex-1 sm:flex-none min-h-11 px-4 py-2 text-sm touch-manipulation ${view === "list" ? "bg-white/10 text-foreground" : "text-muted-foreground"}`}
            >
              List
            </button>
          </div>
          <button
            type="button"
            onClick={openCreate}
            className="w-full sm:w-auto min-h-11 px-5 py-2.5 bg-primary text-primary-foreground rounded-xl font-medium hover:bg-primary-hover focus-ring button-active touch-manipulation"
          >
            + New Deal
          </button>
        </div>
      </div>

      <ExportFiltersBar module="deals" token={token} search={search} onSearchChange={setSearch} className="mb-4" />
      <input
        type="search"
        placeholder="Search deals..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full max-w-md bg-background border border-border rounded-xl px-4 py-3 sm:py-2.5 text-base sm:text-sm text-foreground focus:outline-none focus:border-border mb-6 min-h-11"
      />

      {isLoading ? (
        <PageLoading variant="kanban" label="Loading deals" />
      ) : view === "kanban" ? (
        <>
          {highlightStage && (
            <div className="mb-3 rounded-xl border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-xs text-violet-200">
              Filtered from analytics · highlighting{" "}
              <span className="font-semibold">{stageLabel(highlightStage)}</span>
            </div>
          )}
          {/* Mobile: stacked stage sections (no horizontal squeeze) */}
          <div className="md:hidden space-y-4">
            {STAGES.map((stage) => (
              <div
                key={stage}
                ref={(el) => {
                  stageColRefs.current[stage] = el;
                }}
                className={`bg-card border rounded-2xl p-3 ${
                  highlightStage === stage
                    ? "border-violet-500/60 ring-2 ring-violet-500/30"
                    : "border-border"
                }`}
              >
                <div className="flex items-center justify-between mb-3 px-1">
                  <div className="text-sm font-semibold text-white/90">{stageLabel(stage)}</div>
                  <div className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                    {(dealsByStage[stage] || []).length}
                  </div>
                </div>
                <div className="space-y-3">
                  {(dealsByStage[stage] || []).length > 0 ? (
                    (dealsByStage[stage] || []).map((deal) => (
                      <div
                        key={deal.id || `${stage}-${deal.title}`}
                        className="bg-background border border-border rounded-xl p-3 space-y-2"
                      >
                        <div className="font-medium text-sm text-foreground">{deal.title || "Untitled"}</div>
                        {deal.contact?.name ? (
                          <div className="text-xs text-muted-foreground">{deal.contact.name}</div>
                        ) : null}
                        {dealLeadStatusLabel(deal) ? (
                          <div className="text-[11px] text-sky-300/90">
                            Lead status:{" "}
                            <span className="font-medium text-foreground">
                              {dealLeadStatusLabel(deal)}
                            </span>
                          </div>
                        ) : null}
                        <div className="flex justify-between items-center gap-2">
                          <div className="text-sm text-emerald-400 tabular-nums">
                            {deal.value != null ? formatCurrency(deal.value) : "—"}
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => openEdit(deal)}
                              className="min-h-10 px-3 py-2 bg-white/10 rounded-xl text-xs touch-manipulation"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(deal.id, deal.title)}
                              className="min-h-10 px-3 py-2 text-red-400 border border-red-900/50 rounded-xl text-xs touch-manipulation"
                            >
                              Del
                            </button>
                          </div>
                        </div>
                        {/* Stage change on mobile (no drag) */}
                        <select
                          value={deal.stage}
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
                          className="w-full bg-card border border-border rounded-xl px-3 py-2.5 text-xs text-foreground min-h-10"
                          aria-label={`Change stage for ${deal.title}`}
                        >
                          {STAGES.map((s) => (
                            <option key={s} value={s}>{STAGE_LABELS[s]}</option>
                          ))}
                        </select>
                      </div>
                    ))
                  ) : (
                    <div className="text-center text-muted-foreground text-xs py-6 px-2">
                      No deals in this stage
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Tablet+: multi-column kanban; desktop full 6-col pipeline */}
          <div className="hidden md:grid md:grid-cols-3 lg:grid-cols-6 gap-4">
            {STAGES.map((stage) => (
              <div
                key={stage}
                ref={(el) => {
                  stageColRefs.current[`desk-${stage}`] = el;
                  if (typeof window !== "undefined" && window.innerWidth >= 768) {
                    stageColRefs.current[stage] = el;
                  }
                }}
                className={`bg-card border rounded-2xl p-3 min-h-[400px] ${
                  highlightStage === stage
                    ? "border-violet-500/60 ring-2 ring-violet-500/30"
                    : "border-border"
                }`}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, stage)}
              >
                <div className="flex items-center justify-between mb-3 px-1">
                  <div className="text-sm font-semibold text-white/90">{stageLabel(stage)}</div>
                  <div className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                    {(dealsByStage[stage] || []).length}
                  </div>
                </div>
                <div className="space-y-3">
                  {(dealsByStage[stage] || []).length > 0 ? (
                    (dealsByStage[stage] || []).map((deal) => (
                      <div
                        key={deal.id || `${stage}-${deal.title}`}
                        draggable
                        onDragStart={(e) => handleDragStart(e, deal.id)}
                        className="bg-background border border-border rounded-xl p-3 cursor-grab active:cursor-grabbing hover:border-border"
                      >
                        <div className="font-medium text-sm text-foreground mb-1.5">{deal.title || "Untitled"}</div>
                        {deal.contact?.name ? (
                          <div className="text-xs text-muted-foreground mb-1">{deal.contact.name}</div>
                        ) : null}
                        {dealLeadStatusLabel(deal) ? (
                          <div className="text-[11px] text-sky-300/90 mb-2">
                            Lead status:{" "}
                            <span className="font-medium text-foreground">
                              {dealLeadStatusLabel(deal)}
                            </span>
                          </div>
                        ) : null}
                        <div className="flex justify-between items-center text-xs">
                          <div className="text-emerald-400">
                            {deal.value != null ? formatCurrency(deal.value) : "-"}
                          </div>
                          <div className="flex gap-1.5">
                            <button
                              type="button"
                              onClick={() => openEdit(deal)}
                              className="px-2 py-0.5 bg-white/5 hover:bg-white/10 rounded text-[10px]"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(deal.id, deal.title)}
                              className="px-2 py-0.5 text-red-400 hover:bg-red-950/50 rounded text-[10px]"
                            >
                              Del
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-center text-muted-foreground text-xs py-8 px-2">
                      Drop deals here
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          {/* Mobile list cards */}
          <div className="md:hidden space-y-3">
            {filteredDeals.map((deal) => (
              <div
                key={deal.id}
                className="bg-card border border-border rounded-2xl p-4 space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-foreground truncate">{deal.title || "Untitled"}</div>
                    <div className="text-sm text-muted-foreground mt-0.5">{deal.contact?.name || "—"}</div>
                  </div>
                  <span className="shrink-0 px-2.5 py-0.5 text-xs rounded-full bg-white/10">
                    {stageLabel(deal.stage)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-emerald-400 tabular-nums">
                    {deal.value != null ? formatCurrency(deal.value) : "—"}
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => openEdit(deal)}
                      className="min-h-10 px-3 py-2 text-xs bg-white/10 rounded-xl touch-manipulation"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(deal.id, deal.title)}
                      className="min-h-10 px-3 py-2 text-xs text-red-400 border border-red-900/50 rounded-xl touch-manipulation"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block bg-card border border-border rounded-2xl overflow-hidden">
            <div className="table-scroll">
              <table className="mm-table min-w-[640px]">
                <thead className="border-b border-border text-muted-foreground">
                  <tr>
                    <th className="text-left p-4">Title</th>
                    <th className="text-left p-4">Contact</th>
                    <th className="text-left p-4">Stage</th>
                    <th className="text-left p-4">Value</th>
                    <th className="text-right p-4">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredDeals.map((deal) => (
                    <tr key={deal.id} className="hover:bg-muted/50">
                      <td className="p-4 font-medium text-foreground">{deal.title || "Untitled"}</td>
                      <td className="p-4 text-muted-foreground">{deal.contact?.name || "-"}</td>
                      <td className="p-4">
                        <span className="px-2 py-0.5 text-xs rounded bg-white/10">{stageLabel(deal.stage)}</span>
                      </td>
                      <td className="p-4 text-emerald-400">{deal.value != null ? formatCurrency(deal.value) : "-"}</td>
                      <td className="p-4 text-right space-x-2">
                        <button type="button" onClick={() => openEdit(deal)} className="px-3 py-1 text-xs bg-white/10 hover:bg-white/20 rounded">Edit</button>
                        <button type="button" onClick={() => handleDelete(deal.id, deal.title)} className="px-3 py-1 text-xs text-red-400 hover:bg-red-950/50 rounded border border-red-900/50">Delete</button>
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
        <div className="fixed inset-0 bg-black/70 z-50 flex items-end sm:items-center justify-center sm:p-4">
          <div className="bg-card border border-border rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[92dvh] overflow-y-auto p-4 sm:p-6 safe-bottom">
            <h2 className="text-xl font-semibold mb-6">{editingDeal ? "Edit Deal" : "New Deal"}</h2>
            <form onSubmit={handleSubmit} className="space-y-4 adaptive-form">
              <div>
                <label className="block text-sm text-muted-foreground mb-1">Title *</label>
                <input
                  value={formData.title}
                  onChange={(e) => handleChange("title", e.target.value)}
                  className="w-full bg-background border border-border rounded-xl px-4 py-3 sm:py-2 text-base sm:text-sm min-h-11"
                  required
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-muted-foreground mb-1">Value</label>
                  <CurrencyAmountInput
                    value={formData.value}
                    onValueChange={(raw) => handleChange("value", raw)}
                    className="w-full bg-background border border-border rounded-xl px-4 py-3 sm:py-2 text-base sm:text-sm min-h-11"
                    placeholder="e.g. 1,00,000"
                  />
                </div>
                <div>
                  <label className="block text-sm text-muted-foreground mb-1">Stage</label>
                  <select
                    value={formData.stage}
                    onChange={(e) => handleChange("stage", e.target.value)}
                    className="w-full bg-background border border-border rounded-xl px-4 py-3 sm:py-2 text-base sm:text-sm min-h-11"
                  >
                    {STAGES.map((s) => (
                      <option key={s} value={s}>{STAGE_LABELS[s]}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm text-muted-foreground mb-1">Notes</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => handleChange("notes", e.target.value)}
                  className="w-full bg-background border border-border rounded-xl px-4 py-3 sm:py-2 text-base sm:text-sm h-24"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={closeModal} className="flex-1 min-h-11 px-5 py-2.5 bg-white/10 border border-white/20 rounded-xl text-sm touch-manipulation">Cancel</button>
                <button type="submit" disabled={isSubmitting} className="flex-1 min-h-11 px-5 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-medium disabled:opacity-50 touch-manipulation">
                  {isSubmitting ? "Saving..." : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
