"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader, PageShell } from "@/components/ui/PageShell";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import {
  CUSTOM_FIELD_MODULES,
  normalizeFieldOptions,
  type CustomFieldEntity,
  type FieldDef,
  type FieldOption,
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
};

const emptyDraft = (): Draft => ({
  label: "",
  type: "text",
  description: "",
  placeholder: "",
  required: false,
  order: "",
  optionsText: "",
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

export default function CustomFieldsSettingsPage() {
  const { token, role: authRole } = useAuth();
  const [entity, setEntity] = useState<CustomFieldEntity>("contact");
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());

  const [optionsOpen, setOptionsOpen] = useState(false);
  const [optionsField, setOptionsField] = useState<FieldDef | null>(null);
  const [optionsDraft, setOptionsDraft] = useState<FieldOption[]>([]);

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

  useEffect(() => {
    void load();
  }, [load]);

  const moduleLabel = useMemo(
    () => CUSTOM_FIELD_MODULES.find((m) => m.entity === entity)?.label || entity,
    [entity]
  );

  const needsOptions = FIELD_TYPES.find((t) => t.value === draft.type)?.needsOptions === true;

  const openCreate = () => {
    setEditingKey(null);
    setDraft(emptyDraft());
    setEditorOpen(true);
  };

  const openEdit = (f: FieldDef) => {
    setEditingKey(f.key);
    setDraft({
      label: f.label,
      type: f.type,
      description: f.description || "",
      placeholder: f.placeholder || "",
      required: !!f.required,
      order: f.order != null ? String(f.order) : "",
      optionsText: optionsToText(f.options),
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
    if (needsOptions && !textToOptions(draft.optionsText).length) {
      toast.error("Add at least one option for this field type");
      return;
    }
    setSaving(true);
    const body: Record<string, unknown> = {
      label,
      type: draft.type,
      entity,
      required: draft.required,
      description: draft.description.trim() || undefined,
      placeholder: draft.placeholder.trim() || undefined,
      order: draft.order.trim() ? Number(draft.order) : undefined,
      showInForm: true,
      showInDetail: true,
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
      try {
        const { emitDataChanged } = await import("@/lib/data-events");
        emitDataChanged({ module: "all", action: "update" });
      } catch {
        /* optional */
      }
    } else {
      toast.error(res.error || "Save failed");
    }
  };

  const toggleActive = async (f: FieldDef) => {
    if (!token || !canManage) return;
    const next = f.active === false;
    const res = await api.updateCustomField(token, f.key, { active: next });
    if (res.success) {
      toast.success(next ? "Field activated" : "Field deactivated");
      await load();
    } else toast.error(res.error || "Update failed");
  };

  const deactivate = async (f: FieldDef) => {
    if (!token || !canManage) return;
    if (!confirm(`Deactivate "${f.label}"? Existing record values stay safe.`)) return;
    const res = await api.deactivateCustomField(token, f.key);
    if (res.success) {
      toast.success("Field deactivated");
      await load();
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
      try {
        const { emitDataChanged } = await import("@/lib/data-events");
        emitDataChanged({ module: "all", action: "update" });
      } catch {
        /* optional */
      }
    } else toast.error(res.error || "Failed");
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

  return (
    <PageShell>
      <PageHeader
        eyebrow="Settings · Customization"
        title="Custom Fields"
        description="Add fields and dropdown options for your business — no developer needed. Changes appear on create, edit, and detail screens immediately."
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

        <section className="mm-card p-4 sm:p-5 space-y-4 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="mm-section-title">{moduleLabel}</h2>
              <p className="mm-secondary mt-0.5">
                Fields marked Active appear on forms and detail views for this module.
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
          ) : fields.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-8 text-center">
              <p className="text-sm text-foreground font-medium">No custom fields yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                Create a field like “Service Interested In” and it will show on {moduleLabel} forms.
              </p>
              {canManage ? (
                <button type="button" onClick={openCreate} className="mm-btn-primary text-sm mt-4">
                  + Add Custom Field
                </button>
              ) : null}
            </div>
          ) : (
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
                  {fields.map((f) => {
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
                          {f.coreMap ? (
                            <span className="block text-[10px] text-muted-foreground">core</span>
                          ) : null}
                        </td>
                        <td className="py-3 text-right">
                          <div className="inline-flex flex-wrap justify-end gap-1.5">
                            {canManage && !f.coreMap ? (
                              <>
                                <button
                                  type="button"
                                  className="mm-btn-ghost text-xs px-2 py-1"
                                  onClick={() => openEdit(f)}
                                >
                                  Edit
                                </button>
                                {optionable ? (
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
                                  onClick={() => toggleActive(f)}
                                >
                                  {active ? "Deactivate" : "Activate"}
                                </button>
                                {active ? (
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
                              <span className="text-xs text-muted-foreground">System field</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {/* Create / Edit modal */}
      {editorOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center sm:p-4">
          <div className="bg-card border border-border rounded-t-2xl sm:rounded-lg w-full sm:max-w-lg max-h-[92dvh] overflow-y-auto p-5 sm:p-6">
            <h3 className="text-lg font-semibold mb-1">
              {editingKey ? "Edit Custom Field" : "Add Custom Field"}
            </h3>
            <p className="text-xs text-muted-foreground mb-4">
              Module: <span className="text-foreground font-medium">{moduleLabel}</span>
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
              {needsOptions ? (
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
