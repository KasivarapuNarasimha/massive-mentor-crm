"use client";

import { useEffect, useMemo, useState } from "react";
import { DynamicField } from "@/components/dynamic/DynamicField";
import type { CustomFieldEntity, FieldDef } from "@/lib/business-config";
import { entityFieldsFromConfig, formFields, type BusinessConfigDTO } from "@/lib/business-config";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { FormGrid, FormGridItem, isFormFieldFullWidth } from "@/components/ui/FormLayout";

type Props = {
  entity: CustomFieldEntity;
  /** Controlled values bag (custom field keys only) */
  values: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  /** Optional preloaded defs — skips fetch when provided */
  fields?: FieldDef[];
  /** Optional business config — used when fields not passed */
  config?: BusinessConfigDTO | null;
  title?: string;
  className?: string;
  disabled?: boolean;
};

/**
 * Drop-in section for module forms that are not fully DynamicForm-driven.
 * Loads tenant FieldDefs for `entity` and writes values into a customFields bag.
 */
export function CustomFieldsFormSection({
  entity,
  values,
  onChange,
  fields: fieldsProp,
  config,
  title = "Custom fields",
  className = "",
  disabled,
}: Props) {
  const { token } = useAuth();
  const [loaded, setLoaded] = useState<FieldDef[] | null>(fieldsProp ?? null);

  useEffect(() => {
    if (fieldsProp) {
      setLoaded(fieldsProp);
      return;
    }
    if (config) {
      setLoaded(entityFieldsFromConfig(config, entity));
      return;
    }
    if (!token) return;
    let cancelled = false;
    void (async () => {
      const res = await api.listCustomFields(token, { entity });
      if (cancelled) return;
      if (res.success && res.data?.fields) {
        setLoaded(res.data.fields as FieldDef[]);
      } else {
        setLoaded([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, entity, fieldsProp, config]);

  const visible = useMemo(() => formFields(loaded || []).filter((f) => !f.coreMap), [loaded]);

  if (!visible.length) return null;

  return (
    <div className={`rounded-md border border-border bg-background/50 p-3 space-y-3 ${className}`}>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <FormGrid>
        {visible.map((field) => {
          const fullWidth =
            isFormFieldFullWidth({ key: field.key, type: field.type }) ||
            field.type === "multiselect";
          return (
            <FormGridItem key={field.key} fullWidth={fullWidth}>
              <DynamicField
                field={field}
                value={values[field.key]}
                disabled={disabled}
                onChange={(key, value) => onChange({ ...values, [key]: value })}
              />
            </FormGridItem>
          );
        })}
      </FormGrid>
    </div>
  );
}

/** Helpers for parent forms */
export function customFieldsFromRecord(
  record: { customFields?: unknown } | null | undefined
): Record<string, unknown> {
  const cf = record?.customFields;
  if (cf && typeof cf === "object" && !Array.isArray(cf)) {
    return { ...(cf as Record<string, unknown>) };
  }
  return {};
}
