"use client";

import type { FieldDef } from "@/lib/business-config";
import { normalizeFieldOptions } from "@/lib/business-config";
import { useBusinessCurrency } from "@/lib/use-business-currency";

type Props = {
  fields: FieldDef[];
  values?: Record<string, unknown> | null;
  title?: string;
  className?: string;
};

function formatValue(field: FieldDef, raw: unknown, money: (n: number) => string): string {
  if (raw == null || raw === "") return "—";
  if (field.type === "boolean") return raw ? "Yes" : "No";
  if (field.type === "multiselect" && Array.isArray(raw)) {
    const opts = normalizeFieldOptions(field.options);
    const labelOf = (v: string) => opts.find((o) => o.value === v)?.label || v;
    return raw.map(String).map(labelOf).join(", ") || "—";
  }
  if (field.type === "select" || field.type === "radio") {
    const opts = normalizeFieldOptions(field.options);
    const hit = opts.find((o) => o.value === String(raw));
    return hit?.label || String(raw);
  }
  if (field.type === "currency" || field.type === "number") {
    const n = typeof raw === "number" ? raw : Number(String(raw).replace(/,/g, ""));
    if (!Number.isFinite(n)) return String(raw);
    if (field.type === "currency") return money(n);
    return String(n);
  }
  return String(raw);
}

/** Read-only display of custom (and non-core) field values on detail surfaces */
export function CustomFieldsDetailPanel({
  fields,
  values,
  title = "Custom fields",
  className = "",
}: Props) {
  const { money } = useBusinessCurrency();
  const bag = values && typeof values === "object" ? values : {};
  const visible = fields
    .filter((f) => f.active !== false && f.showInDetail !== false && !f.coreMap)
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  if (!visible.length) return null;

  return (
    <div className={`rounded-md border border-border bg-card p-3 ${className}`}>
      <h3 className="text-sm font-semibold text-foreground mb-2">{title}</h3>
      <dl className="grid gap-2 sm:grid-cols-2 text-sm">
        {visible.map((f) => (
          <div key={f.key} className="min-w-0">
            <dt className="text-[11px] text-muted-foreground">{f.label}</dt>
            <dd className="font-medium text-foreground break-words">
              {formatValue(f, bag[f.key], money)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
