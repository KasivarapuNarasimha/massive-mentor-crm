"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader, PageShell } from "@/components/ui/PageShell";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import {
  CUSTOM_FIELD_MODULES,
  IMMUTABLE_LEAD_STATUS_KEYS,
  normalizeFieldOptions,
  type CustomFieldEntity,
  type FieldDef,
  type FieldOption,
  type PipelineStatus,
} from "@/lib/business-config";
import { toast } from "sonner";

const FIELD_TYPES: Array<{ value: string; label: string; needsOptions?: boolean }> = [
  { value: "text", label: "Short Text" },
  { value: "textarea", label: "Long Text" },
  { value: "number", label: "Number" },
  { value: "currency", label: "Currency" },
  { value: "date", label: "Date" },
  { value: "datetime", label: "Date & Time" },
  { value: "select", label: "Dropdown / Select", needsOptions: true },
  { value: "multiselect", label: "Multi-Select", needsOptions: true },
  { value: "radio", label: "Radio", needsOptions: true },
  { value: "boolean", label: "Yes / No (Checkbox)" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "url", label: "URL" },
];

const TYPE_LABEL: Record<string, string> = Object.fromEntries(
  FIELD_TYPES.map((t) => [t.value, t.label])
);

type Draft = {
  label: string;
  type: string;
  description: string;
  placeholder: string;
  required: boolean;
  order: string;
  optionsText: string;
  showInForm: boolean;
  showInList: boolean;
  showInFilter: boolean;
  showInDetail: boolean;
  defaultValue: string;
  active: boolean;
};

const emptyDraft = (): Draft => ({
  label: "",
  type: "text",
  description: "",
  placeholder: "",
  required: false,
  order: "",
  optionsText: "",
  showInForm: true,
  showInList: false,
  showInFilter: false,
  showInDetail: true,
  defaultValue: "",
  active: true,
});

function optionsToText(options?: FieldDef["options"]): string {
  return normalizeFieldOptions(options)
    .map((o) => o.label || o.value)
    .join("\n");
}

function textToOptions(text: string): FieldOption[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((label, i) => ({
      value: label,
      label,
      active: true,
      order: i,
    }));
}

function isStandardField(f: FieldDef): boolean {
  return !!f.coreMap;
}

type LeadStatusRow = PipelineStatus & { isWon?: boolean; isLost?: boolean };

export default function CustomFieldsSettingsPage() {
  const { token, role: authRole } = useAuth();
  const [entity, setEntity] = useState<CustomFieldEntity>("contact");
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingStandard, setEditingStandard] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft());

  const [optionsOpen, setOptionsOpen] = useState(false);
  const [optionsField, setOptionsField] = useState<FieldDef | null>(null);
  const [optionsDraft, setOptionsDraft] = useState<FieldOption[]>([]);

  const [leadStatuses, setLeadStatuses] = useState<LeadStatusRow[]>([]);
  const [defaultStatusKey, setDefaultStatusKey] = useState("new");
  const [statusesLoading, setStatusesLoading] = useState(false);
  const [newStatusLabel, setNewStatusLabel] = useState("");

  const role = String(authRole || "").toLowerCase();
  const canManage = [
    "super_admin",
    "owner",
    "ceo",
    "business_admin",
    "admin",
    "manager",
  ].includes(role);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    const res = await api.listCustomFields(token, {
      entity,
      includeInactive: true,
    });
    setLoading(false);
    if (res.success && res.data?.fields) {
      setFields(res.data.fields as FieldDef[]);
    } else {
      setFields([]);
      if (res.error) toast.error(res.error);
    }
  }, [token, entity]);

  const loadLeadStatuses = useCallback(async () => {
    if (!token || entity !== "contact") return;
    setStatusesLoading(true);
    const res = await api.listLeadPipelineStatuses(token, { includeInactive: true });
    setStatusesLoading(false);
    if (res.success && res.data) {
      setLeadStatuses((res.data.statuses || []) as LeadStatusRow[]);
      setDefaultStatusKey(res.data.pipeline?.defaultStatusKey || "new");
    } else if (res.error) {
      toast.error(res.error);
    }
  }, [token, entity]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadLeadStatuses();
  }, [loadLeadStatuses]);

  const moduleLabel = useMemo(
    () => CUSTOM_FIELD_MODULES.find((m) => m.entity === entity)?.label || entity,
    [entity]
  );

  const standardFields = useMemo(() => fields.filter(isStandardField), [fields]);
  const customFields = useMemo(() => fields.filter((f) => !isStandardField(f)), [fields]);

  const needsOptions = FIELD_TYPES.find((t) => t.value === draft.type)?.needsOptions === true;

  const emitConfigChanged = async () => {
    try {
      const { emitDataChanged } = await import("@/lib/data-events");
      emitDataChanged({ module: "all", action: "update" });
    } catch {
      /* optional */
    }
  };

  const openCreate = () => {
    setEditingKey(null);
    setEditingStandard(false);
    setDraft(emptyDraft());
    setEditorOpen(true);
  };

  const openEdit = (f: FieldDef, standard: boolean) => {
    setEditingKey(f.key);
    setEditingStandard(standard);
    setDraft({
      label: f.label,
      type: f.type,
      description: f.description || "",
      placeholder: f.placeholder || "",
      required: !!f.required,
      order: f.order != null ? String(f.order) : "",
      optionsText: optionsToText(f.options),
      showInForm: f.showInForm !== false,
      showInList: !!f.showInList,
      showInFilter: !!f.showInFilter,
      showInDetail: f.showInDetail !== false,
      defaultValue: f.defaultValue != null ? String(f.defaultValue) : "",
      active: f.active !== false,
    });
    setEditorOpen(true);
  };

  const openOptions = (f: FieldDef) => {
    setOptionsField(f);
    setOptionsDraft(normalizeFieldOptions(f.options));
    setOptionsOpen(true);
  };

  const saveField = async () => {
    if (!token || !canManage) return;
    const label = draft.label.trim();
    if (!label) {
      toast.error("Field name is required");
      return;
    }
    if (!editingStandard && needsOptions && !textToOptions(draft.optionsText).length) {
      toast.error("Add at least one option for this field type");
      return;
    }
    setSaving(true);

    if (editingKey && editingStandard) {
      const body: Record<string, unknown> = {
        label,
        required: draft.required,
        description: draft.description.trim() || null,
        placeholder: draft.placeholder.trim() || null,
        order: draft.order.trim() ? Number(draft.order) : undefined,
        showInForm: draft.showInForm,
        showInList: draft.showInList,
        showInFilter: draft.showInFilter,
        showInDetail: draft.showInDetail,
        active: draft.active,
        defaultValue: draft.defaultValue.trim() === "" ? null : draft.defaultValue.trim(),
      };
      const res = await api.updateStandardField(token, editingKey, body);
      setSaving(false);
      if (res.success) {
        toast.success("Standard field updated");
        setEditorOpen(false);
        await load();
        await emitConfigChanged();
      } else {
        toast.error(res.error || "Save failed");
      }
      return;
    }

    const body: Record<string, unknown> = {
      label,
      type: draft.type,
      entity,
      required: draft.required,
      description: draft.description.trim() || undefined,
      placeholder: draft.placeholder.trim() || undefined,
      order: draft.order.trim() ? Number(draft.order) : undefined,
      showInForm: draft.showInForm,
      showInDetail: draft.showInDetail,
      showInList: draft.showInList,
      showInFilter: draft.showInFilter,
    };
    if (needsOptions) body.options = textToOptions(draft.optionsText);

    const res = editingKey
      ? await api.updateCustomField(token, editingKey, body)
      : await api.createCustomField(token, body);
    setSaving(false);
    if (res.success) {
      toast.success(editingKey ? "Field updated" : "Custom field created");
      setEditorOpen(false);
      await load();
      await emitConfigChanged();
    } else {
      toast.error(res.error || "Save failed");
    }
  };

  const toggleActive = async (f: FieldDef, standard: boolean) => {
    if (!token || !canManage) return;
    const next = f.active === false;
    const res = standard
      ? await api.updateStandardField(token, f.key, { active: next })
      : await api.updateCustomField(token, f.key, { active: next });
    if (res.success) {
      toast.success(next ? "Field activated" : "Field deactivated");
      await load();
      await emitConfigChanged();
    } else toast.error(res.error || "Update failed");
  };

  const deactivate = async (f: FieldDef) => {
    if (!token || !canManage) return;
    if (!confirm(`Deactivate "${f.label}"? Existing record values stay safe.`)) return;
    const res = await api.deactivateCustomField(token, f.key);
    if (res.success) {
      toast.success("Field deactivated");
      await load();
      await emitConfigChanged();
    } else toast.error(res.error || "Failed");
  };

  const saveOptions = async () => {
    if (!token || !canManage || !optionsField) return;
    const cleaned = optionsDraft
      .map((o, i) => ({
        value: (o.value || o.label || "").trim(),
        label: (o.label || o.value || "").trim(),
        active: o.active !== false,
        order: i,
      }))
      .filter((o) => o.value);
    if (!cleaned.length) {
      toast.error("Keep at least one option");
      return;
    }
    setSaving(true);
    const res = await api.setCustomFieldOptions(token, optionsField.key, cleaned);
    setSaving(false);
    if (res.success) {
      toast.success("Options saved — available on forms immediately");
      setOptionsOpen(false);
      await load();
      await emitConfigChanged();
    } else toast.error(res.error || "Failed");
  };

  const addLeadStatus = async () => {
    if (!token || !canManage) return;
    const label = newStatusLabel.trim();
    if (!label) {
      toast.error("Status label is required");
      return;
    }
    setSaving(true);
    const res = await api.addLeadPipelineStatus(token, { label });
    setSaving(false);
    if (res.success) {
      toast.success("Lead status added");
      setNewStatusLabel("");
      await loadLeadStatuses();
      await emitConfigChanged();
    } else toast.error(res.error || "Failed to add status");
  };

  const renameLeadStatus = async (s: LeadStatusRow, label: string) => {
    if (!token || !canManage) return;
    const trimmed = label.trim();
    if (!trimmed || trimmed === s.label) return;
    const res = await api.updateLeadPipelineStatus(token, s.key, { label: trimmed });
    if (res.success) {
      toast.success("Label updated (stored values unchanged)");
      await loadLeadStatuses();
      await emitConfigChanged();
    } else toast.error(res.error || "Failed");
  };

  const toggleLeadStatusActive = async (s: LeadStatusRow) => {
    if (!token || !canManage) return;
    if (IMMUTABLE_LEAD_STATUS_KEYS.has(s.key) && s.active !== false) {
      toast.error("Won and Lost cannot be archived");
      return;
    }
    const next = s.active === false;
    const res = next
      ? await api.updateLeadPipelineStatus(token, s.key, { active: true })
      : await api.archiveLeadPipelineStatus(token, s.key);
    if (res.success) {
      toast.success(next ? "Status restored" : "Status archived");
      await loadLeadStatuses();
      await emitConfigChanged();
    } else toast.error(res.error || "Failed");
  };

  const moveLeadStatus = async (index: number, dir: -1 | 1) => {
    if (!token || !canManage) return;
    const next = [...leadStatuses];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    setLeadStatuses(next);
    const res = await api.reorderLeadPipelineStatuses(
      token,
      next.map((s) => s.key)
    );
    if (res.success) {
      await loadLeadStatuses();
      await emitConfigChanged();
    } else {
      toast.error(res.error || "Reorder failed");
      await loadLeadStatuses();
    }
  };

  const saveDefaultStatus = async (key: string) => {
    if (!token || !canManage) return;
    setDefaultStatusKey(key);
    const res = await api.setLeadPipelineDefaultStatus(token, key);
    if (res.success) {
      toast.success("Default lead status updated");
      await emitConfigChanged();
    } else {
      toast.error(res.error || "Failed");
      await loadLeadStatuses();
    }
  };

  const groupedModules = useMemo(() => {
    const map = new Map<string, typeof CUSTOM_FIELD_MODULES>();
    for (const m of CUSTOM_FIELD_MODULES) {
      const list = map.get(m.group) || [];
      list.push(m);
      map.set(m.group, list);
    }
    return [...map.entries()];
  }, []);

  const renderFieldRows = (list: FieldDef[], standard: boolean) => {
    if (!list.length) {
      return (
        <div className="rounded-md border border-dashed border-border p-6 text-center">
          <p className="text-sm text-muted-foreground">
            {standard ? "No standard fields in this module." : "No custom fields yet."}
          </p>
          {!standard && canManage ? (
            <button type="button" onClick={openCreate} className="mm-btn-primary text-sm mt-3">
              + Add Custom Field
            </button>
          ) : null}
        </div>
      );
    }
    return (
      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="text-left text-xs text-muted-foreground border-b border-border">
              <th className="py-2 pr-3 font-medium">Field</th>
              <th className="py-2 pr-3 font-medium">Type</th>
              <th className="py-2 pr-3 font-medium">Status</th>
              <th className="py-2 pr-3 font-medium">Source</th>
              <th className="py-2 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {list.map((f) => {
              const active = f.active !== false;
              const optionable = ["select", "multiselect", "radio"].includes(f.type);
              return (
                <tr key={f.key} className="border-b border-border/60 align-top">
                  <td className="py-3 pr-3">
                    <div className="font-medium text-foreground">{f.label}</div>
                    <div className="text-[11px] text-muted-foreground font-mono">{f.key}</div>
                    {f.required ? (
                      <span className="inline-block mt-1 text-[10px] uppercase tracking-wide text-rose-500">
                        Required
                      </span>
                    ) : null}
                    {f.coreMap ? (
                      <span className="inline-block mt-1 ml-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                        core → {f.coreMap}
                      </span>
                    ) : null}
                  </td>
                  <td className="py-3 pr-3 text-muted-foreground">
                    {TYPE_LABEL[f.type] || f.type}
                  </td>
                  <td className="py-3 pr-3">
                    <span
                      className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${
                        active
                          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="py-3 pr-3 text-muted-foreground capitalize">
                    {f.source || (f.coreMap ? "template" : "custom")}
                  </td>
                  <td className="py-3 text-right">
                    <div className="inline-flex flex-wrap justify-end gap-1.5">
                      {canManage ? (
                        <>
                          <button
                            type="button"
                            className="mm-btn-ghost text-xs px-2 py-1"
                            onClick={() => openEdit(f, standard)}
                          >
                            Edit
                          </button>
                          {!standard && optionable ? (
                            <button
                              type="button"
                              className="mm-btn-ghost text-xs px-2 py-1"
                              onClick={() => openOptions(f)}
                            >
                              Manage Options
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="mm-btn-ghost text-xs px-2 py-1"
                            onClick={() => toggleActive(f, standard)}
                          >
                            {active ? "Deactivate" : "Activate"}
                          </button>
                          {!standard && active ? (
                            <button
                              type="button"
                              className="mm-btn-ghost text-xs px-2 py-1 text-rose-600"
                              onClick={() => deactivate(f)}
                            >
                              Archive
                            </button>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">View only</span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <PageShell>
      <PageHeader
        eyebrow="Settings · Customization"
        title="Custom Fields"
        description="Configure standard fields, custom fields, and lead statuses for your business — no developer needed."
      />

      {!canManage ? (
        <div className="mm-card p-4 text-sm text-muted-foreground mb-4">
          You can view field definitions. Only admins and managers can create or edit custom fields.
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[240px_1fr]" data-testid="custom-fields-settings">
        <aside className="mm-card p-3 space-y-4 h-fit lg:sticky lg:top-4">
          {groupedModules.map(([group, mods]) => (
            <div key={group}>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2 px-1">
                {group}
              </p>
              <div className="flex flex-wrap lg:flex-col gap-1.5">
                {mods.map((m) => (
                  <button
                    key={m.entity}
                    type="button"
                    onClick={() => setEntity(m.entity)}
                    className={`text-left px-3 py-2 rounded-md text-sm transition-colors ${
                      entity === m.entity
                        ? "bg-primary text-primary-foreground"
                        : "hover:bg-muted text-foreground"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </aside>

        <div className="space-y-4 min-w-0">
          {entity === "contact" ? (
            <section className="mm-card p-4 sm:p-5 space-y-4" data-testid="lead-status-configure">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="mm-section-title">Lead Status</h2>
                  <p className="mm-secondary mt-0.5">
                    Add, rename, reorder, or archive statuses. Renaming changes the label only —
                    stored lead values keep the same key. Won / Lost keys are fixed.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[12rem]">
                  <label className="mm-label">Default status for new leads</label>
                  <select
                    className="mm-input"
                    value={defaultStatusKey}
                    disabled={!canManage || statusesLoading}
                    onChange={(e) => void saveDefaultStatus(e.target.value)}
                  >
                    {leadStatuses
                      .filter((s) => s.active !== false)
                      .map((s) => (
                        <option key={s.key} value={s.key}>
                          {s.label}
                        </option>
                      ))}
                  </select>
                </div>
                {canManage ? (
                  <div className="flex flex-1 flex-wrap items-end gap-2 min-w-[14rem]">
                    <div className="flex-1 min-w-[10rem]">
                      <label className="mm-label">Add status</label>
                      <input
                        className="mm-input"
                        value={newStatusLabel}
                        onChange={(e) => setNewStatusLabel(e.target.value)}
                        placeholder="e.g. Site Visit"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void addLeadStatus();
                          }
                        }}
                      />
                    </div>
                    <button
                      type="button"
                      className="mm-btn-primary text-sm"
                      disabled={saving}
                      onClick={() => void addLeadStatus()}
                    >
                      + Add
                    </button>
                  </div>
                ) : null}
              </div>

              {statusesLoading ? (
                <p className="text-sm text-muted-foreground py-4 text-center">Loading statuses…</p>
              ) : (
                <div className="space-y-2">
                  {leadStatuses.map((s, idx) => {
                    const active = s.active !== false;
                    const immutable = IMMUTABLE_LEAD_STATUS_KEYS.has(s.key);
                    return (
                      <div
                        key={s.key}
                        className={`flex flex-wrap sm:flex-nowrap items-center gap-2 rounded-md border border-border p-2 ${
                          active ? "" : "opacity-70"
                        }`}
                      >
                        <input
                          className="mm-input flex-1 min-w-[8rem]"
                          defaultValue={s.label}
                          disabled={!canManage}
                          key={`${s.key}-${s.label}`}
                          onBlur={(e) => void renameLeadStatus(s, e.target.value)}
                        />
                        <span className="text-[11px] font-mono text-muted-foreground whitespace-nowrap">
                          {s.key}
                        </span>
                        {immutable ? (
                          <span className="text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400">
                            Fixed
                          </span>
                        ) : null}
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${
                            active
                              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {active ? "Active" : "Archived"}
                        </span>
                        {canManage ? (
                          <div className="flex gap-1">
                            <button
                              type="button"
                              className="mm-btn-ghost text-xs px-2"
                              disabled={idx === 0}
                              onClick={() => void moveLeadStatus(idx, -1)}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              className="mm-btn-ghost text-xs px-2"
                              disabled={idx === leadStatuses.length - 1}
                              onClick={() => void moveLeadStatus(idx, 1)}
                            >
                              ↓
                            </button>
                            {!immutable ? (
                              <button
                                type="button"
                                className="mm-btn-ghost text-xs px-2"
                                onClick={() => void toggleLeadStatusActive(s)}
                              >
                                {active ? "Archive" : "Restore"}
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          ) : null}

          <section className="mm-card p-4 sm:p-5 space-y-4">
            <div>
              <h2 className="mm-section-title">Standard Fields · {moduleLabel}</h2>
              <p className="mm-secondary mt-0.5">
                Core fields (name, phone, status, …). You can change label, required, visibility,
                default, and active — not the field key or type.
              </p>
            </div>
            {loading ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Loading fields…</p>
            ) : (
              renderFieldRows(standardFields, true)
            )}
          </section>

          <section className="mm-card p-4 sm:p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="mm-section-title">Custom Fields · {moduleLabel}</h2>
                <p className="mm-secondary mt-0.5">
                  Tenant-created fields. Changes appear on create, edit, and detail screens
                  immediately.
                </p>
              </div>
              {canManage ? (
                <button type="button" onClick={openCreate} className="mm-btn-primary text-sm">
                  + Add Custom Field
                </button>
              ) : null}
            </div>
            {loading ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Loading fields…</p>
            ) : (
              renderFieldRows(customFields, false)
            )}
          </section>
        </div>
      </div>

      {/* Create / Edit modal */}
      {editorOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center sm:p-4">
          <div className="bg-card border border-border rounded-t-2xl sm:rounded-lg w-full sm:max-w-lg max-h-[92dvh] overflow-y-auto p-5 sm:p-6">
            <h3 className="text-lg font-semibold mb-1">
              {editingKey
                ? editingStandard
                  ? "Edit Standard Field"
                  : "Edit Custom Field"
                : "Add Custom Field"}
            </h3>
            <p className="text-xs text-muted-foreground mb-4">
              Module: <span className="text-foreground font-medium">{moduleLabel}</span>
              {editingStandard ? (
                <span className="block mt-1">
                  Key and type are locked. Stored values are not rewritten when you rename the
                  label.
                </span>
              ) : null}
            </p>
            <div className="space-y-3">
              <div>
                <label className="mm-label">Field Name</label>
                <input
                  className="mm-input"
                  value={draft.label}
                  onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
                  placeholder="e.g. Service Interested In"
                  autoFocus
                />
              </div>
              {!editingStandard ? (
                <div>
                  <label className="mm-label">Field Type</label>
                  <select
                    className="mm-input"
                    value={draft.type}
                    disabled={!!editingKey}
                    onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value }))}
                  >
                    {FIELD_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  {editingKey ? (
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Type cannot be changed after creation.
                    </p>
                  ) : null}
                </div>
              ) : (
                <div>
                  <label className="mm-label">Field Type</label>
                  <input
                    className="mm-input"
                    value={TYPE_LABEL[draft.type] || draft.type}
                    disabled
                  />
                </div>
              )}
              {!editingStandard && needsOptions ? (
                <div>
                  <label className="mm-label">Options (one per line)</label>
                  <textarea
                    className="mm-input min-h-[7rem] resize-y"
                    value={draft.optionsText}
                    onChange={(e) => setDraft((d) => ({ ...d, optionsText: e.target.value }))}
                    placeholder={"SEO\nGoogle Ads\nSocial Media Marketing\nWebsite Development"}
                  />
                </div>
              ) : null}
              <div>
                <label className="mm-label">Help text (optional)</label>
                <input
                  className="mm-input"
                  value={draft.description}
                  onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                  placeholder="Shown under the field label"
                />
              </div>
              <div>
                <label className="mm-label">Placeholder (optional)</label>
                <input
                  className="mm-input"
                  value={draft.placeholder}
                  onChange={(e) => setDraft((d) => ({ ...d, placeholder: e.target.value }))}
                />
              </div>
              {editingStandard ? (
                <div>
                  <label className="mm-label">Default value (optional)</label>
                  <input
                    className="mm-input"
                    value={draft.defaultValue}
                    onChange={(e) => setDraft((d) => ({ ...d, defaultValue: e.target.value }))}
                    placeholder="Used when creating new records"
                  />
                </div>
              ) : null}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mm-label">Display order</label>
                  <input
                    className="mm-input"
                    type="number"
                    value={draft.order}
                    onChange={(e) => setDraft((d) => ({ ...d, order: e.target.value }))}
                    placeholder="Auto"
                  />
                </div>
                <label className="flex items-center gap-2 pt-6 text-sm">
                  <input
                    type="checkbox"
                    checked={draft.required}
                    onChange={(e) => setDraft((d) => ({ ...d, required: e.target.checked }))}
                    className="h-4 w-4 rounded border-border"
                  />
                  Required
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                {(
                  [
                    ["showInForm", "Show in form"],
                    ["showInDetail", "Show in detail"],
                    ["showInList", "Show in list"],
                    ["showInFilter", "Show in filters"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={draft[key]}
                      onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.checked }))}
                      className="h-4 w-4 rounded border-border"
                    />
                    {label}
                  </label>
                ))}
                {editingStandard ? (
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={draft.active}
                      onChange={(e) => setDraft((d) => ({ ...d, active: e.target.checked }))}
                      className="h-4 w-4 rounded border-border"
                    />
                    Active
                  </label>
                ) : null}
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                type="button"
                className="flex-1 mm-btn-ghost"
                onClick={() => setEditorOpen(false)}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="flex-1 mm-btn-primary"
                onClick={() => void saveField()}
                disabled={saving}
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manage options modal */}
      {optionsOpen && optionsField && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center sm:p-4">
          <div className="bg-card border border-border rounded-t-2xl sm:rounded-lg w-full sm:max-w-lg max-h-[92dvh] overflow-y-auto p-5 sm:p-6">
            <h3 className="text-lg font-semibold mb-1">Manage Options</h3>
            <p className="text-xs text-muted-foreground mb-4">
              {optionsField.label} · Disabled options stay on existing records but hide from new
              picks.
            </p>
            <div className="space-y-2">
              {optionsDraft.map((opt, idx) => (
                <div
                  key={`${opt.value}-${idx}`}
                  className="flex flex-wrap sm:flex-nowrap items-center gap-2 rounded-md border border-border p-2"
                >
                  <input
                    className="mm-input flex-1 min-w-[8rem]"
                    value={opt.label}
                    onChange={(e) => {
                      const label = e.target.value;
                      setOptionsDraft((rows) =>
                        rows.map((r, i) =>
                          i === idx
                            ? {
                                ...r,
                                label,
                                value: r.value === r.label ? label : r.value,
                              }
                            : r
                        )
                      );
                    }}
                  />
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={opt.active !== false}
                      onChange={(e) => {
                        const active = e.target.checked;
                        setOptionsDraft((rows) =>
                          rows.map((r, i) => (i === idx ? { ...r, active } : r))
                        );
                      }}
                    />
                    Active
                  </label>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      className="mm-btn-ghost text-xs px-2"
                      disabled={idx === 0}
                      onClick={() => {
                        setOptionsDraft((rows) => {
                          if (idx === 0) return rows;
                          const next = [...rows];
                          [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                          return next;
                        });
                      }}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="mm-btn-ghost text-xs px-2"
                      disabled={idx === optionsDraft.length - 1}
                      onClick={() => {
                        setOptionsDraft((rows) => {
                          if (idx >= rows.length - 1) return rows;
                          const next = [...rows];
                          [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
                          return next;
                        });
                      }}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="mm-btn-ghost text-xs px-2 text-rose-600"
                      onClick={() => {
                        setOptionsDraft((rows) =>
                          rows.map((r, i) => (i === idx ? { ...r, active: false } : r))
                        );
                      }}
                      title="Soft-disable"
                    >
                      Disable
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="mm-btn-ghost text-sm mt-3"
              onClick={() =>
                setOptionsDraft((rows) => [
                  ...rows,
                  { value: "", label: "", active: true, order: rows.length },
                ])
              }
            >
              + Add Option
            </button>
            <div className="flex gap-3 mt-6">
              <button
                type="button"
                className="flex-1 mm-btn-ghost"
                onClick={() => setOptionsOpen(false)}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="flex-1 mm-btn-primary"
                onClick={() => void saveOptions()}
                disabled={saving}
              >
                {saving ? "Saving…" : "Save Options"}
              </button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
