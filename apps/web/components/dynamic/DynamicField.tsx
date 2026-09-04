"use client";

import type { FieldDef } from "@/lib/business-config";
import { activeFieldOptions } from "@/lib/business-config";
import { CurrencyAmountInput } from "@/components/ui/CurrencyAmountInput";
import { getAppCurrency } from "@/lib/currency";

type Props = {
  field: FieldDef;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
  statusOptions?: Array<{ key: string; label: string }>;
  disabled?: boolean;
};

const inputClass = "mm-input";

/** Currency-like field keys even if type is number (legacy templates). */
const MONEY_KEYS = new Set([
  "value",
  "amount",
  "budget",
  "fee",
  "price",
  "revenue",
  "expense",
  "campaign_budget",
  "deal_value",
  "quotation",
  "quotation_amount",
  "invoice_amount",
]);

/**
 * Renders a single field by FieldDef.type only — never by industry.
 */
export function DynamicField({ field, value, onChange, statusOptions, disabled }: Props) {
  const id = `field-${field.key}`;
  const label = (
    <label htmlFor={id} className="mm-label">
      {field.label}
      {field.required ? (
        <span className="text-rose-400/90" aria-hidden>
          {" "}
          *
        </span>
      ) : null}
    </label>
  );

  const str = value == null ? "" : String(value);

  // Status select uses pipeline options when this is the status field
  if (field.coreMap === "status" || field.key === "status") {
    let opts = statusOptions?.length
      ? statusOptions.slice()
      : activeFieldOptions(field.options, str).map((o) => ({ key: o.value, label: o.label }));
    // Keep current value visible even if archived / missing from active list
    if (str && !opts.some((o) => o.key === str)) {
      opts = [...opts, { key: str, label: str }];
    }
    return (
      <div>
        {label}
        <select
          id={id}
          value={str || "new"}
          disabled={disabled}
          onChange={(e) => onChange(field.key, e.target.value)}
          className={inputClass}
        >
          {opts.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  switch (field.type) {
    case "textarea":
      return (
        <div>
          {label}
          <textarea
            id={id}
            value={str}
            disabled={disabled}
            rows={field.rows && field.rows > 0 ? field.rows : field.key === "feedback" ? 6 : 3}
            placeholder={field.placeholder || undefined}
            onChange={(e) => onChange(field.key, e.target.value)}
            className={`${inputClass} resize-y${
              field.key === "feedback" || (field.rows && field.rows >= 5) ? " min-h-[8rem]" : ""
            }`}
          />
        </div>
      );
    case "select":
    case "radio": {
      const opts = activeFieldOptions(field.options, str);
      return (
        <div>
          {label}
          {field.description ? (
            <p className="text-[11px] text-muted-foreground mb-1">{field.description}</p>
          ) : null}
          <select
            id={id}
            value={str}
            disabled={disabled}
            onChange={(e) => onChange(field.key, e.target.value)}
            className={inputClass}
          >
            <option value="">Select…</option>
            {opts.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      );
    }
    case "multiselect": {
      const selected = Array.isArray(value) ? value.map(String) : str ? [str] : [];
      const opts = activeFieldOptions(field.options, selected);
      return (
        <div>
          {label}
          {field.description ? (
            <p className="text-[11px] text-muted-foreground mb-1">{field.description}</p>
          ) : null}
          <select
            id={id}
            multiple
            value={selected}
            disabled={disabled}
            onChange={(e) => {
              const vals = Array.from(e.target.selectedOptions).map((o) => o.value);
              onChange(field.key, vals);
            }}
            className={`${inputClass} min-h-[5.5rem]`}
          >
            {opts.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      );
    }
    case "boolean":
      return (
        <div className="flex items-center gap-2 pt-6">
          <input
            id={id}
            type="checkbox"
            checked={Boolean(value)}
            disabled={disabled}
            onChange={(e) => onChange(field.key, e.target.checked)}
            className="h-4 w-4 rounded border-border"
          />
          <label htmlFor={id} className="text-sm text-muted-foreground">
            {field.label}
          </label>
        </div>
      );
    case "number":
    case "rating":
    case "nps": {
      // Money-named number fields → Indian currency input
      if (
        field.type === "number" &&
        (MONEY_KEYS.has(field.key) ||
          field.coreMap === "value" ||
          /amount|budget|price|fee|revenue|value/i.test(field.key))
      ) {
        return (
          <div>
            {label}
            <CurrencyAmountInput
              id={id}
              value={str}
              disabled={disabled}
              currency={getAppCurrency()}
              className={inputClass}
              onValueChange={(raw) => onChange(field.key, raw === "" ? "" : raw)}
              required={field.required}
            />
          </div>
        );
      }
      return (
        <div>
          {label}
          <input
            id={id}
            type="number"
            value={str}
            disabled={disabled}
            onChange={(e) => onChange(field.key, e.target.value === "" ? "" : e.target.value)}
            className={inputClass}
          />
        </div>
      );
    }
    case "currency":
      return (
        <div>
          {label}
          <CurrencyAmountInput
            id={id}
            value={str}
            disabled={disabled}
            currency={getAppCurrency()}
            className={inputClass}
            onValueChange={(raw) => onChange(field.key, raw === "" ? "" : raw)}
            required={field.required}
          />
        </div>
      );
    case "date":
    case "datetime":
      return (
        <div>
          {label}
          <input
            id={id}
            type={field.type === "datetime" ? "datetime-local" : "date"}
            value={str}
            disabled={disabled}
            onChange={(e) => onChange(field.key, e.target.value)}
            className={inputClass}
          />
        </div>
      );
    case "email":
      return (
        <div>
          {label}
          <input
            id={id}
            type="email"
            value={str}
            disabled={disabled}
            placeholder={field.placeholder || undefined}
            onChange={(e) => onChange(field.key, e.target.value)}
            className={inputClass}
            required={field.required}
          />
        </div>
      );
    case "phone":
      return (
        <div>
          {label}
          <input
            id={id}
            type="tel"
            value={str}
            disabled={disabled}
            placeholder={field.placeholder || undefined}
            onChange={(e) => onChange(field.key, e.target.value)}
            className={inputClass}
            required={field.required}
          />
        </div>
      );
    case "url":
      return (
        <div>
          {label}
          <input
            id={id}
            type="url"
            value={str}
            disabled={disabled}
            placeholder={field.placeholder || "https://"}
            onChange={(e) => onChange(field.key, e.target.value)}
            className={inputClass}
            required={field.required}
          />
        </div>
      );
    default:
      return (
        <div>
          {label}
          {field.description ? (
            <p className="text-[11px] text-muted-foreground mb-1">{field.description}</p>
          ) : null}
          <input
            id={id}
            type="text"
            value={str}
            disabled={disabled}
            placeholder={field.placeholder || undefined}
            onChange={(e) => onChange(field.key, e.target.value)}
            className={inputClass}
            required={field.required}
          />
        </div>
      );
  }
}
