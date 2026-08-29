"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { useBusinessCurrency } from "@/lib/use-business-currency";
import { DynamicForm, buildContactPayload, contactToFormValues } from "@/components/dynamic/DynamicForm";
import { ExportFiltersBar } from "@/components/ui/ExportFiltersBar";
import { PageLoading } from "@/components/ui/PageLoading";
import { EmptyState } from "@/components/ui/EmptyState";
import { friendlyError, SuccessMsg } from "@/lib/user-messages";
import { NotesPanel } from "@/components/crm/NotesPanel";
import { CustomFieldsDetailPanel } from "@/components/custom-fields/CustomFieldsDetailPanel";
import {
  type BusinessConfigDTO,
  type FieldDef,
  contactFieldsFromConfig,
  FALLBACK_CONTACT_FIELDS,
  applyTemplateLeadFieldVisibility,
} from "@/lib/business-config";

interface Contact {
  id: string;
  type: string;
  status: string;
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  source?: string;
  value?: number;
  /** not_revenue | expected | received */
  financialStatus?: string | null;
  description?: string;
  lastContactedAt?: string;
  customFields?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

type FinancialStatus = "not_revenue" | "expected" | "received";

export default function ClientsPage() {
  const { token, role } = useAuth();
  const { money } = useBusinessCurrency();
  const [clients, setClients] = useState<Contact[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editingClient, setEditingClient] = useState<Contact | null>(null);
  const [formValues, setFormValues] = useState<Record<string, unknown>>({});
  const [bizConfig, setBizConfig] = useState<BusinessConfigDTO | null>(null);
  const [templateSlug, setTemplateSlug] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  /** Explicit Finance bridge (does not change CRM Client Value meaning) */
  const [finStatus, setFinStatus] = useState<FinancialStatus>("not_revenue");
  const [finAmount, setFinAmount] = useState("");
  const [finDate, setFinDate] = useState("");
  const [finDealId, setFinDealId] = useState("");
  const [clientDeals, setClientDeals] = useState<Array<{ id: string; title: string; value?: number | null; stage?: string }>>([]);
  const [finBusy, setFinBusy] = useState(false);

  const fieldDefs: FieldDef[] = useMemo(() => {
    const from = contactFieldsFromConfig(bizConfig);
    const base = from.length ? from : FALLBACK_CONTACT_FIELDS;
    return applyTemplateLeadFieldVisibility(base, templateSlug);
  }, [bizConfig, templateSlug]);

  // Client lifecycle statuses (not the Lead telecalling pipeline)
  const statusOptions = useMemo(
    () => [
      { key: "active", label: "Active" },
      { key: "churned", label: "Churned" },
      { key: "won", label: "Won" },
      { key: "new", label: "New" },
    ],
    []
  );

  const loadConfig = useCallback(async () => {
    if (!token) return;
    const res = await api.getBusinessConfig(token);
    if (res.success && res.data) {
      setBizConfig((res.data.config as BusinessConfigDTO) || null);
      setTemplateSlug(res.data.business?.templateSlug || null);
    }
  }, [token]);

  const loadClients = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    const response = await api.getCrmContacts("?type=client", token);
    const data = response.data as { contacts?: Contact[] } | undefined;
    if (response.success && data?.contacts) {
      setClients(data.contacts);
    } else {
      toast.error(friendlyError(response.error, "Could not load clients. Please try again."));
    }
    setIsLoading(false);
  }, [token]);

  useEffect(() => {
    loadConfig();
    loadClients();
  }, [loadConfig, loadClients]);

  // Refresh field defs when Settings → Custom Fields changes
  useEffect(() => {
    let unsub = () => {};
    void import("@/lib/data-events").then(({ subscribeDataChanged }) => {
      unsub = subscribeDataChanged(() => {
        void loadConfig();
      });
    });
    return () => unsub();
  }, [loadConfig]);

  const filteredClients = clients.filter((client) => {
    const matchesSearch =
      !search ||
      client.name.toLowerCase().includes(search.toLowerCase()) ||
      (client.company && client.company.toLowerCase().includes(search.toLowerCase())) ||
      (client.email && client.email.toLowerCase().includes(search.toLowerCase()));
    const matchesStatus = !statusFilter || client.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const openCreate = () => {
    setEditingClient(null);
    setFormValues(
      contactToFormValues(fieldDefs, { status: statusOptions[0]?.key || "active" })
    );
    setShowModal(true);
  };

  const openEdit = async (client: Contact) => {
    setEditingClient(client);
    setFormValues(contactToFormValues(fieldDefs, client as unknown as Record<string, unknown>));
    const fs = (client.financialStatus || "not_revenue") as FinancialStatus;
    setFinStatus(
      fs === "expected" || fs === "received" ? fs : "not_revenue"
    );
    setFinAmount(
      client.value != null && Number.isFinite(Number(client.value))
        ? String(client.value)
        : ""
    );
    setFinDate(new Date().toISOString().slice(0, 10));
    setFinDealId("");
    setClientDeals([]);
    setShowModal(true);
    if (token) {
      try {
        const res = await api.getCrmDeals(`?contactId=${encodeURIComponent(client.id)}`, token);
        const data = res.data as { deals?: Array<{ id: string; title: string; value?: number | null; stage?: string }> } | undefined;
        if (res.success && data?.deals) {
          setClientDeals(data.deals);
          const won = data.deals.find((d) => /won/i.test(String(d.stage || "")));
          if (won) setFinDealId(won.id);
        }
      } catch {
        /* optional */
      }
    }
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingClient(null);
    setClientDeals([]);
  };

  const handleAddToFinance = async () => {
    if (!token || !editingClient) return;
    setFinBusy(true);
    const amount =
      finStatus === "received"
        ? Number(String(finAmount).replace(/,/g, ""))
        : 0;
    const res = await api.post(
      "/finance/crm/client-revenue",
      {
        contactId: editingClient.id,
        financialStatus: finStatus,
        amount: finStatus === "received" ? amount : undefined,
        revenueDate: finDate || undefined,
        dealId: finDealId || undefined,
        description: `Client: ${editingClient.company || editingClient.name}`,
      },
      token
    );
    setFinBusy(false);
    if (res.success) {
      const d = res.data as {
        recorded?: boolean;
        amount?: number;
        sourceType?: string;
        message?: string;
      };
      if (d?.recorded) {
        toast.success(
          `Revenue recorded in Finance (${money(d.amount || amount)})`,
          {
            description:
              d.sourceType === "deal"
                ? "Linked as Deal source (no double count)"
                : "Source: Client",
          }
        );
      } else {
        toast.message(d?.message || "Financial status saved");
      }
      const { emitDataChanged } = await import("@/lib/data-events");
      emitDataChanged({ module: "finance", action: "update" });
      await loadClients();
    } else {
      toast.error(friendlyError(res.error, "Could not update Finance."));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;

    const payload = buildContactPayload(fieldDefs, formValues, "client");
    if (!payload.name || !String(payload.name).trim()) {
      toast.error("Name is required");
      return;
    }

    setIsSubmitting(true);
    const response = editingClient
      ? await api.updateCrmContact(editingClient.id, payload, token)
      : await api.createCrmContact(payload, token);

    if (response.success) {
      toast.success(editingClient ? SuccessMsg.clientUpdated : SuccessMsg.clientCreated);
      closeModal();
      const { emitDataChanged } = await import("@/lib/data-events");
      emitDataChanged({
        module: "contact",
        action: editingClient ? "update" : "create",
      });
      emitDataChanged({ module: "notification", action: "create" });
      await loadClients();
    } else {
      toast.error(friendlyError(response.error, "Could not save client. Please try again."));
    }

    setIsSubmitting(false);
  };

  const handleDelete = async (id: string, name: string) => {
    if (!token) return;
    if (!confirm(`Delete client "${name}"? This action cannot be undone.`)) return;

    const response = await api.deleteCrmContact(id, token);
    if (response.success) {
      toast.success("Client deleted successfully");
      await loadClients();
    } else {
      toast.error(friendlyError(response.error, "Could not delete client. Please try again."));
    }
  };

  return (
    <div className="w-full max-w-6xl mx-auto px-3 sm:px-6 py-4 sm:py-6 overflow-x-hidden pb-24 md:pb-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4 sm:mb-5">
        <div className="min-w-0">
          <h1 className="mm-page-title">Clients</h1>
          <p className="mm-secondary mt-1">
            Manage your existing clients and accounts.
          </p>
          {templateSlug ? (
            <p className="mm-secondary mt-1">Template: {templateSlug}</p>
          ) : null}
        </div>
        <button
          onClick={openCreate}
          className="mm-btn mm-btn-primary w-full sm:w-auto h-9 min-h-9 px-4 text-[13px] focus-ring touch-manipulation"
        >
          + New Client
        </button>
      </div>

      <ExportFiltersBar
        module="clients"
        token={token}
        search={search}
        onSearchChange={setSearch}
        className="mb-3"
      />

      <div className="mm-filter-bar mb-4">
        <input
          type="search"
          placeholder="Search clients..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mm-input flex-1 min-w-[12rem]"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="mm-input w-full sm:w-auto"
        >
          <option value="">All Statuses</option>
          {statusOptions.map((s) => (
            <option key={s.key} value={s.key}>{s.label}</option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <PageLoading variant="table" rows={5} label="Loading clients" />
      ) : filteredClients.length === 0 ? (
        <EmptyState
          title={clients.length === 0 ? "No clients yet" : "No matching clients"}
          description={
            clients.length === 0
              ? "Add your first client or convert a won lead."
              : "Try adjusting search or filters."
          }
          icon={<span className="text-2xl">🤝</span>}
          action={
            clients.length === 0 ? (
              <button
                type="button"
                onClick={openCreate}
                className="mm-btn mm-btn-primary h-9 min-h-9 px-5 focus-ring"
              >
                Create Client
              </button>
            ) : undefined
          }
        />
      ) : (
        <>
          {/* Mobile / tablet card list */}
          <div className="md:hidden space-y-2.5">
            {filteredClients.map((client) => (
              <div
                key={client.id}
                className="mm-card p-3 space-y-2.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-[13px] text-foreground truncate">{client.name}</div>
                    {client.email && (
                      <div className="text-xs text-muted-foreground truncate">{client.email}</div>
                    )}
                    <div className="mm-secondary mt-1">{client.company || "—"}</div>
                  </div>
                  <span className="mm-badge shrink-0">
                    {client.status}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] text-foreground tabular-nums">
                    {client.value != null ? money(client.value) : "—"}
                  </span>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => openEdit(client)}
                      className="mm-btn mm-btn-secondary h-9 min-h-9 px-2.5 text-xs touch-manipulation"
                    >
                      Edit
                    </button>
                    {(role === "manager" || role === "admin" || role === "business_admin") && (
                      <button
                        onClick={() => handleDelete(client.id, client.name)}
                        className="mm-btn mm-btn-danger h-9 min-h-9 px-2.5 text-xs touch-manipulation"
                      >
                        Delete
                      </button>
                    )}
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
                    <th>Name</th>
                    <th>Company</th>
                    <th>Status</th>
                    <th>Value</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredClients.map((client) => (
                    <tr key={client.id}>
                      <td>
                        <div>
                          <div className="font-medium text-foreground">{client.name}</div>
                          {client.email && (
                            <div className="text-xs text-muted-foreground">{client.email}</div>
                          )}
                        </div>
                      </td>
                      <td className="text-muted-foreground">{client.company || "-"}</td>
                      <td>
                        <span className="mm-badge">
                          {client.status}
                        </span>
                      </td>
                      <td className="text-foreground tabular-nums">
                        {client.value != null ? money(client.value) : "-"}
                      </td>
                      <td className="text-right space-x-1.5">
                        <button
                          onClick={() => openEdit(client)}
                          className="mm-btn mm-btn-secondary h-8 min-h-8 px-2.5 text-xs"
                        >
                          Edit
                        </button>
                        {(role === "manager" || role === "admin" || role === "business_admin") && (
                          <button
                            onClick={() => handleDelete(client.id, client.name)}
                            className="mm-btn mm-btn-danger h-8 min-h-8 px-2.5 text-xs"
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
          </div>
        </>
      )}

      {showModal && (
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center sm:p-4 bg-black/50 dark:bg-black/60">
          <div className="relative w-full bg-card border border-border shadow-lg rounded-t-xl sm:rounded-lg max-h-[min(92dvh,100dvh)] sm:max-h-[85vh] flex flex-col overflow-hidden sm:max-w-3xl">
            <div className="shrink-0 px-4 sm:px-5 py-3 border-b border-border">
              <h2 className="mm-section-title text-base">
                {editingClient ? "Edit Client" : "New Client"}
              </h2>
              {templateSlug ? (
                <p className="mm-secondary mt-1">Fields from template: {templateSlug}</p>
              ) : null}
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 sm:px-5 py-4 space-y-3">
              <DynamicForm
                formId="client-form"
                fields={fieldDefs}
                values={formValues}
                onChange={(k, v) => setFormValues((prev) => ({ ...prev, [k]: v }))}
                onSubmit={handleSubmit}
                statusOptions={statusOptions}
                disabled={isSubmitting}
              />
              {editingClient ? (
                <CustomFieldsDetailPanel
                  className="mt-1"
                  title="Saved custom values"
                  fields={fieldDefs}
                  values={
                    (clients.find((c) => c.id === editingClient.id)?.customFields ||
                      editingClient.customFields ||
                      {}) as Record<string, unknown>
                  }
                />
              ) : null}

              {/* Finance bridge — explicit only; Client Value stays CRM LTV */}
              {editingClient ? (
                <div className="mm-card p-3 space-y-3">
                  <div>
                    <h3 className="mm-section-title text-[13px]">Finance</h3>
                    <p className="mm-secondary mt-0.5">
                      Client Value is CRM only. Use this section to record actual revenue in Finance
                      (Finance roles / Admin). Prevents double-counting with Won Deals.
                    </p>
                  </div>
                  <div>
                    <label className="mm-label">Financial Status</label>
                    <select
                      className="mm-input"
                      value={finStatus}
                      onChange={(e) => setFinStatus(e.target.value as FinancialStatus)}
                    >
                      <option value="not_revenue">Not Revenue</option>
                      <option value="expected">Expected Revenue</option>
                      <option value="received">Revenue Received</option>
                    </select>
                  </div>
                  {finStatus === "received" && (
                    <>
                      <div>
                        <label className="mm-label">Amount</label>
                        <input
                          type="text"
                          inputMode="decimal"
                          className="mm-input"
                          value={finAmount}
                          onChange={(e) => setFinAmount(e.target.value)}
                          placeholder="e.g. 90000"
                        />
                      </div>
                      <div>
                        <label className="mm-label">Revenue Date</label>
                        <input
                          type="date"
                          className="mm-input"
                          value={finDate}
                          onChange={(e) => setFinDate(e.target.value)}
                        />
                      </div>
                      {clientDeals.length > 0 && (
                        <div>
                          <label className="mm-label">
                            Linked Deal (optional — preferred if Won)
                          </label>
                          <select
                            className="mm-input"
                            value={finDealId}
                            onChange={(e) => setFinDealId(e.target.value)}
                          >
                            <option value="">— Client only —</option>
                            {clientDeals.map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.title}
                                {d.value != null ? ` · ${money(Number(d.value))}` : ""}
                                {d.stage ? ` (${d.stage})` : ""}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </>
                  )}
                  <button
                    type="button"
                    disabled={finBusy}
                    onClick={() => void handleAddToFinance()}
                    className={`mm-btn mm-btn-primary w-full ${finBusy ? "mm-btn-loading" : ""}`}
                  >
                    {finBusy
                      ? "Saving…"
                      : finStatus === "received"
                        ? "Add / Update Finance"
                        : "Save Financial Status"}
                  </button>
                </div>
              ) : null}

              {editingClient?.id ? (
                <div className="mt-3 pt-3 border-t border-border">
                  <NotesPanel
                    entityType="contact"
                    entityId={editingClient.id}
                    compact
                    title="Attached notes"
                  />
                </div>
              ) : null}
            </div>
            <div className="shrink-0 border-t border-border px-4 sm:px-5 pt-3 modal-footer-safe bg-background-secondary/60 flex gap-2 relative z-10">
              <button
                type="button"
                onClick={closeModal}
                className="mm-btn mm-btn-secondary flex-1 touch-manipulation min-h-11"
              >
                Cancel
              </button>
              <button
                type="submit"
                form="client-form"
                disabled={isSubmitting}
                className={`mm-btn mm-btn-primary flex-1 touch-manipulation min-h-11 ${isSubmitting ? "mm-btn-loading" : ""}`}
              >
                {isSubmitting ? "Saving..." : editingClient ? "Update Client" : "Create Client"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
