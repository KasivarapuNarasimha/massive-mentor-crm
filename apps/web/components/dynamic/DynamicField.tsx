"use client";

import type { FieldDef } from "@/lib/business-config";
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
    const opts = statusOptions?.length
      ? statusOptions
      : (field.options || []).map((o) => ({ key: o, label: o }));
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
            rows={3}
            onChange={(e) => onChange(field.key, e.target.value)}
            className={`${inputClass} resize-y`}
          />
        </div>
      );
    case "select":
      return (
        <div>
          {label}
          <select
            id={id}
            value={str}
            disabled={disabled}
            onChange={(e) => onChange(field.key, e.target.value)}
            className={inputClass}
          >
            <option value="">Select…</option>
            {(field.options || []).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>
      );
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
          <input
            id={id}
            type="text"
            value={str}
            disabled={disabled}
            onChange={(e) => onChange(field.key, e.target.value)}
            className={inputClass}
            required={field.required}
          />
        </div>
      );
  }
}
