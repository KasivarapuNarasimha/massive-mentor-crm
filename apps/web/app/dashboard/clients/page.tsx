"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/currency";
import { DynamicForm, buildContactPayload, contactToFormValues } from "@/components/dynamic/DynamicForm";
import { ExportFiltersBar } from "@/components/ui/ExportFiltersBar";
import {
  type BusinessConfigDTO,
  type FieldDef,
  contactFieldsFromConfig,
  leadStatusesFromConfig,
  FALLBACK_CONTACT_FIELDS,
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
  description?: string;
  lastContactedAt?: string;
  customFields?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export default function ClientsPage() {
  const { token, role } = useAuth();
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

  const fieldDefs: FieldDef[] = useMemo(() => {
    const from = contactFieldsFromConfig(bizConfig);
    return from.length ? from : FALLBACK_CONTACT_FIELDS;
  }, [bizConfig]);

  const statusOptions = useMemo(() => {
    const from = leadStatusesFromConfig(bizConfig);
    if (from.length) return from.map((s) => ({ key: s.key, label: s.label }));
    return [
      { key: "active", label: "active" },
      { key: "churned", label: "churned" },
      { key: "new", label: "new" },
    ];
  }, [bizConfig]);

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
      toast.error(response.error || "Failed to load clients");
    }
    setIsLoading(false);
  }, [token]);

  useEffect(() => {
    loadConfig();
    loadClients();
  }, [loadConfig, loadClients]);

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

  const openEdit = (client: Contact) => {
    setEditingClient(client);
    setFormValues(contactToFormValues(fieldDefs, client as unknown as Record<string, unknown>));
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingClient(null);
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
      toast.success(editingClient ? "Client updated" : "Client created");
      closeModal();
      const { emitDataChanged } = await import("@/lib/data-events");
      emitDataChanged({
        module: "contact",
        action: editingClient ? "update" : "create",
      });
      emitDataChanged({ module: "notification", action: "create" });
      await loadClients();
    } else {
      toast.error(response.error || "Operation failed");
    }

    setIsSubmitting(false);
  };

  const handleDelete = async (id: string, name: string) => {
    if (!token) return;
    if (!confirm(`Delete client "${name}"? This action cannot be undone.`)) return;

    const response = await api.deleteCrmContact(id, token);
    if (response.success) {
      toast.success("Client deleted");
      await loadClients();
    } else {
      toast.error(response.error || "Failed to delete");
    }
  };

  return (
    <div className="w-full max-w-6xl mx-auto px-3 sm:px-6 py-4 sm:py-8 overflow-x-hidden pb-24 md:pb-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6 sm:mb-8">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Clients</h1>
          <p className="text-muted-foreground mt-1 sm:mt-2 text-sm sm:text-base">
            Manage your existing clients and accounts.
          </p>
          {templateSlug ? (
            <p className="text-xs text-muted-foreground mt-1">Template: {templateSlug}</p>
          ) : null}
        </div>
        <button
          onClick={openCreate}
          className="w-full sm:w-auto min-h-11 px-5 py-2.5 bg-primary text-primary-foreground rounded-xl font-medium hover:bg-primary-hover focus-ring button-active transition-colors touch-manipulation"
        >
          + New Client
        </button>
      </div>

      <ExportFiltersBar
        module="clients"
        token={token}
        search={search}
        onSearchChange={setSearch}
        className="mb-4"
      />

      <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 mb-5 sm:mb-6">
        <input
          type="search"
          placeholder="Search clients..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 bg-background border border-border rounded-xl px-4 py-3 sm:py-2.5 text-base sm:text-sm text-foreground focus:outline-none focus:border-border min-h-11"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-background border border-border rounded-xl px-4 py-3 sm:py-2.5 text-base sm:text-sm text-foreground focus:outline-none focus:border-border min-h-11"
        >
          <option value="">All Statuses</option>
          {statusOptions.map((s) => (
            <option key={s.key} value={s.key}>{s.label}</option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <div className="bg-card border border-border rounded-2xl p-8">
          <div className="animate-pulse space-y-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-16 bg-muted rounded-xl" />
            ))}
          </div>
        </div>
      ) : filteredClients.length === 0 ? (
        <div className="bg-card border border-border rounded-2xl p-12 text-center">
          <div className="mx-auto w-16 h-16 bg-muted rounded-2xl flex items-center justify-center mb-6">
            <span className="text-3xl">🤝</span>
          </div>
          <h3 className="text-xl font-semibold mb-2">No clients found</h3>
          <p className="text-muted-foreground mb-6">Start by adding your first client.</p>
          <button
            onClick={openCreate}
            className="px-6 py-2.5 bg-primary text-primary-foreground rounded-xl font-medium hover:bg-primary-hover focus-ring button-active"
          >
            Create Client
          </button>
        </div>
      ) : (
        <>
          {/* Mobile / tablet card list */}
          <div className="md:hidden space-y-3">
            {filteredClients.map((client) => (
              <div
                key={client.id}
                className="bg-card border border-border rounded-2xl p-4 space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-foreground truncate">{client.name}</div>
                    {client.email && (
                      <div className="text-xs text-muted-foreground truncate">{client.email}</div>
                    )}
                    <div className="text-sm text-muted-foreground mt-1">{client.company || "—"}</div>
                  </div>
                  <span className="shrink-0 px-2.5 py-0.5 text-xs rounded-full bg-white/10 border border-white/10">
                    {client.status}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {client.value != null ? formatCurrency(client.value) : "—"}
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => openEdit(client)}
                      className="min-h-10 px-3 py-2 text-xs bg-white/10 rounded-xl border border-white/10 touch-manipulation"
                    >
                      Edit
                    </button>
                    {(role === "manager" || role === "admin" || role === "business_admin") && (
                      <button
                        onClick={() => handleDelete(client.id, client.name)}
                        className="min-h-10 px-3 py-2 text-xs text-red-400 rounded-xl border border-red-900/50 touch-manipulation"
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
          <div className="hidden md:block bg-card border border-border rounded-2xl overflow-hidden">
            <div className="table-scroll">
              <table className="mm-table min-w-[640px]">
                <thead className="border-b border-border text-muted-foreground">
                  <tr>
                    <th className="text-left p-4 font-medium">Name</th>
                    <th className="text-left p-4 font-medium">Company</th>
                    <th className="text-left p-4 font-medium">Status</th>
                    <th className="text-left p-4 font-medium">Value</th>
                    <th className="text-right p-4 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredClients.map((client) => (
                    <tr key={client.id} className="hover:bg-muted/50 transition-colors">
                      <td className="p-4">
                        <div>
                          <div className="font-medium text-foreground">{client.name}</div>
                          {client.email && (
                            <div className="text-xs text-muted-foreground">{client.email}</div>
                          )}
                        </div>
                      </td>
                      <td className="p-4 text-muted-foreground">{client.company || "-"}</td>
                      <td className="p-4">
                        <span className="inline-block px-2.5 py-0.5 text-xs rounded-full bg-white/10 text-white/80 border border-white/10">
                          {client.status}
                        </span>
                      </td>
                      <td className="p-4 text-muted-foreground">
                        {client.value != null ? formatCurrency(client.value) : "-"}
                      </td>
                      <td className="p-4 text-right space-x-2">
                        <button
                          onClick={() => openEdit(client)}
                          className="px-3 py-1 text-xs bg-white/10 hover:bg-white/20 rounded-lg border border-white/10"
                        >
                          Edit
                        </button>
                        {(role === "manager" || role === "admin" || role === "business_admin") && (
                          <button
                            onClick={() => handleDelete(client.id, client.name)}
                            className="px-3 py-1 text-xs text-red-400 hover:bg-red-950/50 rounded-lg border border-red-900/50"
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
        <div className="fixed inset-0 bg-black/70 z-50 flex items-end sm:items-center justify-center sm:p-4">
          <div className="bg-card border border-border rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[92dvh] flex flex-col overflow-hidden p-4 sm:p-6 safe-bottom">
            <h2 className="text-xl font-semibold mb-2">{editingClient ? "Edit Client" : "New Client"}</h2>
            {templateSlug ? (
              <p className="text-xs text-muted-foreground mb-4">Fields from template: {templateSlug}</p>
            ) : (
              <div className="mb-4" />
            )}
            <div className="flex-1 overflow-y-auto">
              <DynamicForm
                formId="client-form"
                fields={fieldDefs}
                values={formValues}
                onChange={(k, v) => setFormValues((prev) => ({ ...prev, [k]: v }))}
                onSubmit={handleSubmit}
                statusOptions={statusOptions}
                disabled={isSubmitting}
              />
            </div>
            <div className="flex gap-3 mt-6">
              <button
                type="button"
                onClick={closeModal}
                className="flex-1 px-5 py-2.5 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl text-sm font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                form="client-form"
                disabled={isSubmitting}
                className="flex-1 px-5 py-2.5 bg-primary text-primary-foreground rounded-xl font-medium hover:bg-primary-hover disabled:opacity-50"
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
