"use client";

import { DynamicField } from "@/components/dynamic/DynamicField";
import type { FieldDef } from "@/lib/business-config";
import { formFields } from "@/lib/business-config";
import { parseAmount } from "@/lib/currency";

type Props = {
  fields: FieldDef[];
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  statusOptions?: Array<{ key: string; label: string }>;
  formId?: string;
  onSubmit?: (e: React.FormEvent) => void;
  disabled?: boolean;
};

/**
 * Builds a form entirely from FieldDef metadata.
 */
export function DynamicForm({
  fields,
  values,
  onChange,
  statusOptions,
  formId = "dynamic-form",
  onSubmit,
  disabled,
}: Props) {
  const visible = formFields(fields);

  return (
    <form id={formId} onSubmit={onSubmit} className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {visible.map((field) => {
          const fullWidth = field.type === "textarea" || field.key === "description";
          return (
            <div key={field.key} className={fullWidth ? "sm:col-span-2" : undefined}>
              <DynamicField
                field={field}
                value={values[field.key]}
                onChange={onChange}
                statusOptions={statusOptions}
                disabled={disabled}
              />
            </div>
          );
        })}
      </div>
    </form>
  );
}

/** Build API payload: core columns + customFields bag */
export function buildContactPayload(
  fields: FieldDef[],
  values: Record<string, unknown>,
  type: "lead" | "client" = "lead"
): Record<string, unknown> {
  const customFields: Record<string, unknown> = {};
  const payload: Record<string, unknown> = { type };

  for (const field of fields) {
    const v = values[field.key];
    if (v === undefined) continue;

    if (field.coreMap) {
      if (field.coreMap === "description") {
        payload.notes = v === "" ? null : v;
        payload.description = v === "" ? null : v;
      } else if (field.coreMap === "value") {
        if (v === "" || v === null) payload.value = null;
        else {
          payload.value = parseAmount(v as string | number);
        }
      } else {
        payload[field.coreMap] = v === "" ? null : v;
      }
    } else if (["name", "email", "phone", "company", "status", "source"].includes(field.key)) {
      payload[field.key] = v === "" ? null : v;
    } else {
      customFields[field.key] = v === "" ? null : v;
    }
  }

  // Ensure name
  if (!payload.name && values.name) payload.name = values.name;
  if (!payload.status) payload.status = values.status || "new";

  payload.customFields = customFields;
  // Also pass custom keys at root for FieldEngine passthrough
  for (const [k, v] of Object.entries(customFields)) {
    if (payload[k] === undefined) payload[k] = v;
  }

  return payload;
}

/** Initialize form values from a contact record */
export function contactToFormValues(
  fields: FieldDef[],
  contact: Record<string, unknown> | null
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  const custom = (contact?.customFields || {}) as Record<string, unknown>;

  for (const field of fields) {
    if (field.coreMap && contact && contact[field.coreMap] != null) {
      values[field.key] = contact[field.coreMap];
    } else if (contact && contact[field.key] != null && field.key !== "customFields") {
      values[field.key] = contact[field.key];
    } else if (custom[field.key] != null) {
      values[field.key] = custom[field.key];
    } else if (field.defaultValue !== undefined) {
      values[field.key] = field.defaultValue;
    } else {
      values[field.key] = field.type === "boolean" ? false : "";
    }
  }

  if (contact?.status && values.status === "") values.status = contact.status;
  if (contact?.description && !values.description) values.description = contact.description;

  return values;
}
